import { describe, it, expect } from 'vitest'
import { deriveMetrics, lpIrr } from './live-report'
import { computeCapitalAccounts, emptyAccount, type CapitalPosting } from './capital-account'

describe('lpIrr', () => {
  // Contributions are CREDITS to LP capital → negative postings. Distributions are debits.
  const contribution = (date: string, amount: number): CapitalPosting =>
    ({ lpEntityId: 'a', amount: -amount, sourceType: 'capital_call', entryDate: date })
  const distribution = (date: string, amount: number): CapitalPosting =>
    ({ lpEntityId: 'a', amount, sourceType: 'distribution', entryDate: date })

  it('returns a plausible IRR for a simple double-in-two-years', () => {
    // 1m in, nothing out, worth 2m two years later → ~41% IRR.
    const irr = lpIrr([contribution('2024-01-01', 1_000_000)], 2_000_000, '2026-01-01')
    expect(irr).toBeGreaterThan(0.38)
    expect(irr).toBeLessThan(0.44)
  })

  it('counts a distribution as money back to the LP', () => {
    // Same money in, but half returned early → a better IRR than leaving it all in the fund.
    const early = lpIrr(
      [contribution('2024-01-01', 1_000_000), distribution('2025-01-01', 1_000_000)],
      1_000_000,
      '2026-01-01'
    )
    const none = lpIrr([contribution('2024-01-01', 1_000_000)], 2_000_000, '2026-01-01')
    expect(early!).toBeGreaterThan(none!)
  })

  it('treats remaining capital as a terminal inflow at the reporting date', () => {
    // A partial loss has a real, negative IRR.
    const partial = lpIrr([contribution('2024-01-01', 1_000_000)], 600_000, '2026-01-01')
    expect(partial).toBeLessThan(0)
    expect(partial).toBeGreaterThan(-1)
  })

  it('returns null on a TOTAL loss rather than inventing a number', () => {
    // Money in, nothing back, nothing left. There is no finite rate that discounts the flows to
    // zero — a -100% return has no IRR. Returning null is the honest answer; a fabricated
    // large-negative figure would look like a real measurement.
    expect(lpIrr([contribution('2024-01-01', 1_000_000)], 0, '2026-01-01')).toBeNull()
  })

  it('IGNORES fees, marks and gains — the NAV already contains them', () => {
    // Including these as cash flows would count the same economics twice: once as a flow and
    // again inside the terminal NAV.
    const withNoise: CapitalPosting[] = [
      contribution('2024-01-01', 1_000_000),
      { lpEntityId: 'a', amount: 20_000, sourceType: 'management_fee', entryDate: '2024-06-01' },
      { lpEntityId: 'a', amount: -500_000, sourceType: 'valuation', entryDate: '2025-06-01' },
    ]
    const clean = lpIrr([contribution('2024-01-01', 1_000_000)], 2_000_000, '2026-01-01')
    const noisy = lpIrr(withNoise, 2_000_000, '2026-01-01')
    expect(noisy).toBe(clean)
  })

  it('handles several calls over time', () => {
    const irr = lpIrr(
      [
        contribution('2024-01-01', 500_000),
        contribution('2024-07-01', 300_000),
        contribution('2025-01-01', 200_000),
      ],
      1_500_000,
      '2026-01-01'
    )
    expect(irr).not.toBeNull()
    expect(irr!).toBeGreaterThan(0)
  })

  it('returns null when there is nothing to compute from', () => {
    expect(lpIrr([], 1_000_000, '2026-01-01')).toBeNull()
    // Only a NAV and no contributions — no outflow, so no rate of return exists.
    expect(lpIrr([distribution('2025-01-01', 100)], 0, '2026-01-01')).toBeNull()
  })
})

/**
 * `deriveMetrics` turns a capital account into `lp_investments`-shaped metric columns. The
 * sign conventions are the trap: a capital account is a CREDIT balance, so postings arrive
 * debit-positive and `capitalDelta = -amount`. Contributions land positive, distributions
 * land NEGATIVE, and lp_investments stores distributions as a positive cumulative figure.
 * Get that backwards and every LP's DPI flips sign while still looking plausible.
 */
describe('deriveMetrics', () => {
  const acct = (over: Partial<ReturnType<typeof emptyAccount>>) => ({ ...emptyAccount(), ...over })

  it('derives the full metric set from a funded, marked-up position', () => {
    // 500k contributed, 50k distributed, ending capital 700k.
    const a = acct({ contributions: 500_000, distributions: -50_000, ending: 700_000 })
    const m = deriveMetrics(a, 1_000_000, 0)

    expect(m.commitment).toBe(1_000_000)
    expect(m.called_capital).toBe(500_000)
    expect(m.paid_in_capital).toBe(500_000)
    expect(m.distributions).toBe(50_000) // stored positive, negated from the account
    expect(m.nav).toBe(700_000)
    expect(m.total_value).toBe(750_000) // nav + distributions
    expect(m.outstanding_balance).toBe(500_000) // commitment - paid in
    expect(m.dpi).toBe(0.1) // 50k / 500k
    expect(m.rvpi).toBe(1.4) // 700k / 500k
    expect(m.tvpi).toBe(1.5) // (50k + 700k) / 500k
  })

  // PAID-IN IS CALLED CAPITAL, and an unpaid call does not change it.
  //
  // This test used to assert the opposite — paid_in = called − receivable — which meant
  // `paid_in_capital` here denoted FUNDED, while the identically-named column on the
  // `lp_investments` rows these are deliberately shaped like denotes CALLED. Every LP with an
  // outstanding call therefore showed as a difference in the live-vs-snapshot reconciliation
  // that was purely definitional, and their DPI/TVPI disagreed with their own snapshot.
  it('an unpaid call does not reduce paid-in — capital is recognized when CALLED', () => {
    // 500k called, but 200k of it has not been wired yet.
    const a = acct({ contributions: 500_000, ending: 500_000 })
    const m = deriveMetrics(a, 1_000_000, 200_000)

    expect(m.called_capital).toBe(500_000)
    expect(m.paid_in_capital).toBe(500_000)      // = called. The 200k is unfunded, not un-paid-in.
    expect(m.outstanding_balance).toBe(500_000)  // commitment − called: what is left to CALL.
    // Ratios run off recognized capital, so they do not jump when the wire lands.
    expect(m.rvpi).toBeCloseTo(1.0, 4)
  })

  it('treats an events vehicle (no receivable) as called === paid in', () => {
    const a = acct({ contributions: 250_000, ending: 250_000 })
    const m = deriveMetrics(a, 250_000, 0)
    expect(m.called_capital).toBe(250_000)
    expect(m.paid_in_capital).toBe(250_000)
    expect(m.outstanding_balance).toBe(0)
  })

  it('gives an LP with a commitment but no activity a clean unfunded row', () => {
    const m = deriveMetrics(emptyAccount(), 1_000_000, 0)
    expect(m.paid_in_capital).toBe(0)
    expect(m.nav).toBe(0)
    expect(m.outstanding_balance).toBe(1_000_000)
    // No division by zero — ratios are null, not NaN or Infinity.
    expect(m.dpi).toBeNull()
    expect(m.rvpi).toBeNull()
    expect(m.tvpi).toBeNull()
  })

  it('handles a fully realised position (all capital returned, nav 0)', () => {
    const a = acct({ contributions: 400_000, distributions: -600_000, ending: 0 })
    const m = deriveMetrics(a, 400_000, 0)
    expect(m.distributions).toBe(600_000)
    expect(m.nav).toBe(0)
    expect(m.total_value).toBe(600_000)
    expect(m.dpi).toBe(1.5)
    expect(m.rvpi).toBe(0)
    expect(m.tvpi).toBe(1.5)
  })

  it('does not let fees and losses leak into called/paid-in', () => {
    // Fees and expenses reduce ending capital but are NOT a return of capital and must
    // never be mistaken for a distribution.
    const a = acct({
      contributions: 500_000,
      managementFees: -10_000,
      expenses: -5_000,
      unrealizedGains: 100_000,
      ending: 585_000,
    })
    const m = deriveMetrics(a, 500_000, 0)
    expect(m.called_capital).toBe(500_000)
    expect(m.paid_in_capital).toBe(500_000)
    expect(m.distributions).toBe(0)
    expect(m.nav).toBe(585_000)
    expect(m.total_value).toBe(585_000)
  })

  it('round-trips from raw postings through computeCapitalAccounts', () => {
    // The real path: debit-positive postings in, metrics out. A contribution is a CREDIT to
    // LP capital, hence a negative amount.
    const postings: CapitalPosting[] = [
      { lpEntityId: 'a', amount: -1_000_000, sourceType: 'capital_call', entryDate: '2026-01-15' },
      { lpEntityId: 'a', amount: 200_000, sourceType: 'distribution', entryDate: '2026-06-30' },
      { lpEntityId: 'a', amount: -300_000, sourceType: 'valuation', entryDate: '2026-06-30' },
    ]
    const m = deriveMetrics(computeCapitalAccounts(postings).get('a')!, 1_000_000, 0)

    expect(m.called_capital).toBe(1_000_000)
    expect(m.distributions).toBe(200_000)
    expect(m.nav).toBe(1_100_000) // 1.0m in - 200k out + 300k markup
    expect(m.total_value).toBe(1_300_000)
    expect(m.tvpi).toBe(1.3)
  })

  it('scopes to an as-of date the same way for either producer', () => {
    const postings: CapitalPosting[] = [
      { lpEntityId: 'a', amount: -500_000, sourceType: 'capital_call', entryDate: '2026-01-15' },
      { lpEntityId: 'a', amount: -500_000, sourceType: 'capital_call', entryDate: '2026-09-01' },
    ]
    // Mid-year: only the first call has happened.
    const mid = deriveMetrics(computeCapitalAccounts(postings, { end: '2026-06-30' }).get('a')!, 1_000_000, 0)
    expect(mid.called_capital).toBe(500_000)
    expect(mid.outstanding_balance).toBe(500_000)

    const end = deriveMetrics(computeCapitalAccounts(postings).get('a')!, 1_000_000, 0)
    expect(end.called_capital).toBe(1_000_000)
    expect(end.outstanding_balance).toBe(0)
  })
})
