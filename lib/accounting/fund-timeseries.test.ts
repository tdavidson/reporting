import { describe, it, expect } from 'vitest'
import { buildCapitalSeries, buildNewFollowOnSeries, quarterEndsThrough, type CapitalSeriesPoint } from './fund-timeseries'

// Postings are DEBIT-POSITIVE deltas to LP equity (credit-normal), so a contribution — which
// increases capital — arrives as a NEGATIVE amount, and `capitalDelta = -amount` flips it back
// positive. Getting that sign backwards inverts the whole fund, so it's the first thing pinned.
const p = (entryDate: string, sourceType: string, capitalDelta: number) => ({
  entryDate, sourceType, amount: -capitalDelta, // store as debit-positive
})

const at = (points: CapitalSeriesPoint[], label: string) => points.find(x => x.label === label)!

describe('quarterEndsThrough', () => {
  it('walks quarter-ends from the start quarter through the end date, inclusive', () => {
    expect(quarterEndsThrough('2024-02-10', '2024-09-30')).toEqual([
      '2024-03-31', '2024-06-30', '2024-09-30',
    ])
  })

  it('appends the reporting date\'s own quarter even when it is mid-quarter', () => {
    // Ends 2024-08-15 → the Q3 bucket must exist so the curve ends on "now", not on Q2.
    expect(quarterEndsThrough('2024-01-05', '2024-08-15')).toEqual([
      '2024-03-31', '2024-06-30', '2024-09-30',
    ])
  })
})

describe('buildCapitalSeries', () => {
  const quarters = quarterEndsThrough('2024-01-01', '2024-12-31')

  it('buckets each posting into its quarter and accumulates forward', () => {
    const series = buildCapitalSeries(
      [
        p('2024-01-15', 'capital_call', 1_000_000),   // Q1
        p('2024-04-20', 'capital_call', 500_000),     // Q2
        p('2024-07-10', 'distribution', -200_000),    // Q3, returns capital
      ],
      quarters,
    )
    expect(at(series, "Q1 '24").calledCapital).toBe(1_000_000)
    expect(at(series, "Q2 '24").calledCapital).toBe(1_500_000) // cumulative
    expect(at(series, "Q3 '24").calledCapital).toBe(1_500_000) // no new calls
    expect(at(series, "Q3 '24").distributed).toBe(200_000)     // reported positive
    expect(at(series, "Q4 '24").calledCapital).toBe(1_500_000) // carries to the end
  })

  it('composes NAV from the signed buckets, and it ties to their sum', () => {
    const series = buildCapitalSeries(
      [
        p('2024-01-15', 'capital_call', 1_000_000),
        p('2024-02-01', 'management_fee', -20_000),
        p('2024-03-01', 'valuation', 300_000),        // unrealized gain
        p('2024-03-15', 'distribution', -100_000),
      ],
      quarters,
    )
    const q1 = at(series, "Q1 '24")
    expect(q1.contributions).toBe(1_000_000)
    expect(q1.expenses).toBe(-20_000)
    expect(q1.unrealizedGains).toBe(300_000)
    expect(q1.distributions).toBe(-100_000)
    // NAV = sum of every signed component.
    expect(q1.nav).toBe(1_000_000 - 20_000 + 300_000 - 100_000)
    const sum = q1.contributions + q1.distributions + q1.operatingIncome +
      q1.realizedGains + q1.unrealizedGains + q1.expenses + q1.other
    expect(q1.nav).toBeCloseTo(sum, 2)
  })

  it('folds reallocations (carry, transfers, unclassified) onto one neutral line', () => {
    const series = buildCapitalSeries(
      [
        p('2024-01-15', 'capital_call', 1_000_000),
        p('2024-02-01', 'carried_interest', -50_000),
        p('2024-02-01', 'transfer', 50_000),
        p('2024-02-01', 'manual', 123),
      ],
      quarters,
    )
    const q1 = at(series, "Q1 '24")
    expect(q1.other).toBe(-50_000 + 50_000 + 123)
    // Whole-fund, carry + transfers net to zero across partners; here `other` still ties into NAV.
    expect(q1.nav).toBe(1_000_000 + q1.other)
  })

  it('is empty when there are no quarters', () => {
    expect(buildCapitalSeries([p('2024-01-01', 'capital_call', 1)], [])).toEqual([])
  })
})

describe('buildNewFollowOnSeries', () => {
  const quarters = quarterEndsThrough('2024-01-01', '2024-12-31')

  it('classifies the first investment as new and later ones as follow-on, cumulatively', () => {
    // One company: an initial check in Q1, a follow-on in Q3.
    const s = buildNewFollowOnSeries(
      [[{ date: '2024-02-01', cost: 100 }, { date: '2024-08-01', cost: 40 }]],
      quarters,
    )
    // Q1 (index 0): only the new check has landed.
    expect(s[0]).toEqual({ newInvested: 100, followOnInvested: 0 })
    // Q2 (index 1): still just the new check — follow-on not yet deployed.
    expect(s[1]).toEqual({ newInvested: 100, followOnInvested: 0 })
    // Q3 (index 2): follow-on now counts.
    expect(s[2]).toEqual({ newInvested: 100, followOnInvested: 40 })
    // new + follow-on ties to total invested at the end.
    expect(s[3].newInvested + s[3].followOnInvested).toBe(140)
  })

  it('treats the earliest check per company as new regardless of input order', () => {
    // Two companies; rows given out of date order. Each company's first-by-date row is its new check.
    const s = buildNewFollowOnSeries(
      [
        [{ date: '2024-08-01', cost: 30 }, { date: '2024-02-01', cost: 70 }], // A: new=70, follow=30
        [{ date: '2024-05-01', cost: 50 }],                                    // B: new=50
      ],
      quarters,
    )
    // By year end: new = 70 + 50 = 120, follow-on = 30.
    expect(s[3]).toEqual({ newInvested: 120, followOnInvested: 30 })
  })
})
