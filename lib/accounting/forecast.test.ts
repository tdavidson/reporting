import { describe, it, expect } from 'vitest'
import {
  runForecast, buildExpectedPath, forecastLedgerText, defaultAssumptions,
  expectedMultiple, quarterEndDate,
  DEFAULT_EXISTING_TIERS,
  type ForecastAssumptions, type ForecastPosition, type ForecastFundBase,
} from './forecast'

const positions: ForecastPosition[] = [
  { name: 'Acme', fairValue: 4_000_000, cost: 1_500_000 },
  { name: 'Bolt', fairValue: 2_500_000, cost: 2_000_000 },
  { name: 'Written off already', fairValue: 0, cost: 500_000 },
]

const base: ForecastFundBase = { committed: 20_000_000, paidIn: 10_000_000, distributions: 1_000_000 }

const assumptions = (over: Partial<ForecastAssumptions> = {}): ForecastAssumptions => ({
  ...defaultAssumptions('2026-06-30'),
  newInvestments: {
    count: 8, averageCheck: 500_000, deploymentYears: 2,
    tiers: [
      { label: 'Write-off', pct: 0.5, multiple: 0 },
      { label: 'Winner', pct: 0.5, multiple: 4 },
    ],
    hold: { minYears: 3, maxYears: 6 },
  },
  annualFeesPct: 0.02,
  feeYears: 4,
  ...over,
})

describe('quarterEndDate', () => {
  it('steps quarterly from asOf', () => {
    expect(quarterEndDate('2026-06-30', 0)).toBe('2026-09-29')
    expect(quarterEndDate('2026-06-30', 3)).toBe('2027-06-29')
  })
})

describe('expectedMultiple', () => {
  it('is the weight-normalized mean of the tiers', () => {
    expect(expectedMultiple([
      { label: 'a', pct: 0.5, multiple: 0 },
      { label: 'b', pct: 0.5, multiple: 4 },
    ])).toBe(2)
  })
  it('handles unnormalized weights', () => {
    expect(expectedMultiple([
      { label: 'a', pct: 1, multiple: 1 },
      { label: 'b', pct: 3, multiple: 5 },
    ])).toBe(4)
  })
})

describe('runForecast', () => {
  it('is reproducible for a fixed seed', () => {
    const a = runForecast(positions, base, assumptions(), { iterations: 200, seed: 42 })
    const b = runForecast(positions, base, assumptions(), { iterations: 200, seed: 42 })
    expect(a.tvpi.samples).toEqual(b.tvpi.samples)
    expect(a.nav.map(x => x.p50)).toEqual(b.nav.map(x => x.p50))
  })

  it('differs across seeds', () => {
    const a = runForecast(positions, base, assumptions(), { iterations: 200, seed: 1 })
    const b = runForecast(positions, base, assumptions(), { iterations: 200, seed: 2 })
    expect(a.tvpi.mean).not.toBe(b.tvpi.mean)
  })

  it('simulation mean total value reconciles to the deterministic expectation', () => {
    // With lognormal means anchored to the tier multiples, mean simulated proceeds from
    // existing positions ≈ fair value × E[multiple]. Zero new investments and zero fees
    // isolate the existing book. Everything exits inside the horizon (hold ≤ 4y < 8y),
    // so terminal NAV is 0 and total value is pure proceeds.
    const a = assumptions({
      newInvestments: { ...assumptions().newInvestments, count: 0, averageCheck: 0 },
      annualFeesPct: 0,
      feeYears: 0,
      existing: { tiers: DEFAULT_EXISTING_TIERS, hold: { minYears: 1, maxYears: 4 } },
    })
    const res = runForecast(positions, base, a, { iterations: 8000, seed: 7 })
    const fvBase = 6_500_000
    const expected = (base.distributions + fvBase * expectedMultiple(DEFAULT_EXISTING_TIERS)) / base.paidIn
    expect(res.tvpi.mean).toBeGreaterThan(expected * 0.93)
    expect(res.tvpi.mean).toBeLessThan(expected * 1.07)
  })

  it('percentiles are ordered and NAV starts near the current book', () => {
    const res = runForecast(positions, base, assumptions(), { iterations: 500, seed: 3 })
    const t = res.tvpi
    expect(t.p5).toBeLessThanOrEqual(t.p25)
    expect(t.p25).toBeLessThanOrEqual(t.p50)
    expect(t.p50).toBeLessThanOrEqual(t.p75)
    expect(t.p75).toBeLessThanOrEqual(t.p95)
    // First-quarter median NAV should be in the neighbourhood of today's marks plus
    // early deployment — not zero, not a multiple of the book.
    const q0 = res.nav[0]
    expect(q0.p50).toBeGreaterThan(2_000_000)
    expect(q0.p50).toBeLessThan(20_000_000)
  })

  it('denominator = paid-in + new capital + fees, and falls back to fair value', () => {
    const res = runForecast(positions, base, assumptions(), { iterations: 50, seed: 3 })
    expect(res.denominator.source).toBe('paid_in')
    expect(res.denominator.newCapital).toBe(4_000_000)
    expect(res.denominator.fees).toBe(20_000_000 * 0.02 * 4)
    expect(res.denominator.total).toBe(10_000_000 + 4_000_000 + 1_600_000)

    const tracking = runForecast(positions, { committed: 0, paidIn: 0, distributions: 0 }, assumptions({ annualFeesPct: 0 }), { iterations: 50, seed: 3 })
    expect(tracking.denominator.source).toBe('fair_value')
    expect(tracking.denominator.total).toBe(6_500_000 + 4_000_000)
  })

  it('all-write-off tiers produce a certain loss', () => {
    const a = assumptions({
      existing: { tiers: [{ label: 'Zero', pct: 1, multiple: 0 }], hold: { minYears: 1, maxYears: 2 } },
      newInvestments: { ...assumptions().newInvestments, count: 0 },
      annualFeesPct: 0, feeYears: 0,
    })
    const res = runForecast(positions, base, a, { iterations: 100, seed: 9 })
    expect(res.probBelowCapital).toBe(1)
    // Terminal NAV and distributions both zero; only prior distributions remain.
    expect(res.tvpi.p95).toBeCloseTo(1_000_000 / 10_000_000, 6)
  })

  it('positions with zero fair value are excluded', () => {
    const a = assumptions({ newInvestments: { ...assumptions().newInvestments, count: 0 }, annualFeesPct: 0, feeYears: 0 })
    const only = runForecast(positions.slice(0, 2), base, a, { iterations: 100, seed: 5 })
    const withDead = runForecast(positions, base, a, { iterations: 100, seed: 5 })
    expect(withDead.tvpi.samples).toEqual(only.tvpi.samples)
  })
})

describe('buildExpectedPath', () => {
  it('books deployment, fees and exits on the deterministic schedule', () => {
    const path = buildExpectedPath(positions, base, assumptions())
    const totalInvested = path.quarters.reduce((s, q) => s + q.invested, 0)
    expect(totalInvested).toBeCloseTo(4_000_000, 2)
    const totalFees = path.quarters.reduce((s, q) => s + q.fees, 0)
    expect(totalFees).toBeCloseTo(20_000_000 * 0.02 * 4, 2)
    // Called = invested + fees in every quarter.
    for (const q of path.quarters) expect(q.called).toBeCloseTo(q.invested + q.fees, 2)
    // The existing book exits once, at the midpoint hold, at the expected multiple.
    const exMult = expectedMultiple(DEFAULT_EXISTING_TIERS)
    const totalProceeds = path.quarters.reduce((s, q) => s + q.proceeds, 0)
    const newMult = expectedMultiple(assumptions().newInvestments.tiers)
    expect(totalProceeds).toBeCloseTo(6_500_000 * exMult + 4_000_000 * newMult, 0)
  })

  it('reports TVPI over the full forecast denominator', () => {
    const path = buildExpectedPath(positions, base, assumptions())
    expect(path.tvpi).not.toBeNull()
    const denom = 10_000_000 + 4_000_000 + 1_600_000
    const totalProceeds = path.quarters.reduce((s, q) => s + q.proceeds, 0)
    expect(path.tvpi!).toBeCloseTo((1_000_000 + totalProceeds + path.terminalNav) / denom, 6)
  })
})

describe('forecastLedgerText', () => {
  it('emits draft-flagged entries that balance', () => {
    const text = forecastLedgerText(buildExpectedPath(positions, base, assumptions()))
    expect(text).toContain('FORECAST')
    // Every transaction line uses the draft flag, never the posting flag.
    const txLines = text.split('\n').filter(l => /^\d{4}-\d{2}-\d{2}/.test(l))
    expect(txLines.length).toBeGreaterThan(0)
    for (const l of txLines) expect(l).toMatch(/^\d{4}-\d{2}-\d{2} ! /)

    // Each entry's postings sum to ~zero.
    const blocks = text.split('\n\n')
    for (const block of blocks) {
      const amounts = block.split('\n')
        .filter(l => /USD$/.test(l.trim()))
        .map(l => Number(l.trim().split(/\s+/).slice(-2)[0]))
      if (amounts.length === 0) continue
      const sum = amounts.reduce((s, a) => s + a, 0)
      expect(Math.abs(sum)).toBeLessThan(0.02)
    }
  })

  it('books a realized loss as a debit on 4000 when proceeds fall short of cost', () => {
    // Force expected proceeds below cost: existing book exits at 0.5x of fair value with
    // fair value below cost on one position.
    const a = assumptions({
      existing: { tiers: [{ label: 'Half', pct: 1, multiple: 0.5 }], hold: { minYears: 1, maxYears: 1 } },
      newInvestments: { ...assumptions().newInvestments, count: 0 },
      annualFeesPct: 0, feeYears: 0,
    })
    const lossPositions: ForecastPosition[] = [{ name: 'Under water', fairValue: 1_000_000, cost: 2_000_000 }]
    const text = forecastLedgerText(buildExpectedPath(lossPositions, base, a))
    // Proceeds 500k, cost released 2m → 4000 leg is a POSITIVE (debit) 1.5m loss.
    expect(text).toContain('Income:Realized-Gains:4000              1500000.00 USD')
  })
})
