import { describe, it, expect } from 'vitest'
import { rollUp } from './fund-economics'
import { emptyAccount, type CapitalAccount } from './capital-account'

const acct = (p: Partial<CapitalAccount>): CapitalAccount => ({ ...emptyAccount(), ...p })

// A capital account is a CREDIT balance: contributions arrive positive, distributions
// arrive NEGATIVE. Getting that backwards inverts the fund's whole performance, so it is
// the first thing these pin.
describe('rollUp', () => {
  it('sums the partners and computes the multiples off paid-in', () => {
    const m = rollUp(
      [
        acct({ contributions: 600_000, distributions: -200_000, ending: 700_000 }),
        acct({ contributions: 400_000, distributions: -100_000, ending: 500_000 }),
      ],
      2_000_000,
      [],
      null,
    )
    expect(m.paidIn).toBe(1_000_000)
    expect(m.distributions).toBe(300_000)        // negated off the account
    expect(m.nav).toBe(1_200_000)
    expect(m.totalValue).toBe(1_500_000)
    expect(m.committed).toBe(2_000_000)
    expect(m.uncalled).toBe(1_000_000)           // commitment − paid-in (= called)
    expect(m.dpi).toBeCloseTo(0.3)
    expect(m.rvpi).toBeCloseTo(1.2)
    expect(m.tvpi).toBeCloseTo(1.5)
  })

  it('NAV is already net of accrued carry — there is nothing to estimate', () => {
    // The close reallocates carry from LP capital to GP capital. An LP account is therefore
    // ALREADY net; the old Funds page applied a heuristic haircut on top, because it had no
    // way to know the real number.
    const lp = acct({ contributions: 1_000_000, ending: 1_800_000, carriedInterest: -200_000 })
    const m = rollUp([lp], 1_000_000, [], null)
    expect(m.nav).toBe(1_800_000)   // the account's own ending — no haircut applied
    expect(m.tvpi).toBeCloseTo(1.8)
  })

  it('an empty slice is zeroes, not a crash — a vehicle with no GP still reports', () => {
    const m = rollUp([], 500_000, [], null)
    expect(m).toMatchObject({ paidIn: 0, nav: 0, dpi: null, tvpi: null, irr: null })
    expect(m.committed).toBe(500_000)
  })

  it('ratios are null (not zero, not Infinity) when nothing has been called', () => {
    const m = rollUp([acct({ ending: 0 })], 1_000_000, [], null)
    expect(m.dpi).toBeNull()
    expect(m.tvpi).toBeNull()
  })

  it('IRR terminal value lands on the REPORTING date, not today', () => {
    // The old fund page pushed the residual at `new Date()` regardless of the as-of date,
    // which discounted future flows back to today and made a historical as-of meaningless.
    const flows = [{ date: new Date('2024-01-01'), amount: -1_000_000 }]
    const a = acct({ contributions: 1_000_000, ending: 2_000_000 })

    const at2026 = rollUp([a], 1_000_000, flows, new Date('2026-01-01'))
    const at2025 = rollUp([a], 1_000_000, flows, new Date('2025-01-01'))

    // Same doubling, reached SOONER, is a higher IRR. If the terminal date were ignored the
    // two would be identical.
    expect(at2025.irr!).toBeGreaterThan(at2026.irr!)
    expect(at2026.irr!).toBeCloseTo(0.4142, 2)   // 2x over 2 years
  })

  it('no IRR from a single flow', () => {
    expect(rollUp([acct({ contributions: 100 })], 100, [], null).irr).toBeNull()
  })
})
