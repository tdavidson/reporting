import { describe, it, expect } from 'vitest'
import { buildCapitalSeries, quarterEndsThrough, type CapitalSeriesPoint } from './fund-timeseries'

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
