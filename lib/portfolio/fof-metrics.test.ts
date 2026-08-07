import { describe, it, expect } from 'vitest'
import { computeFundPositions, type FundHoldingTerms, type FundCapitalEvent, type FundNavStatement } from './fof-metrics'

const terms: FundHoldingTerms[] = [
  { companyId: 'f1', name: 'Acme Ventures III', managerName: 'Acme', vintageYear: 2021, strategy: 'Early stage', commitment: 5_000_000 },
]

// $3m called across two notices; $1.2m distributed, of which $200k is recallable.
const events: FundCapitalEvent[] = [
  { companyId: 'f1', kind: 'call', eventDate: '2021-06-30', amount: 2_000_000, recallableAmount: 0, charReturnOfCapital: 0, charRealizedGain: 0, charIncome: 0 },
  { companyId: 'f1', kind: 'call', eventDate: '2022-06-30', amount: 1_000_000, recallableAmount: 0, charReturnOfCapital: 0, charRealizedGain: 0, charIncome: 0 },
  { companyId: 'f1', kind: 'distribution', eventDate: '2024-09-30', amount: 1_200_000, recallableAmount: 200_000, charReturnOfCapital: 800_000, charRealizedGain: 400_000, charIncome: 0 },
]

const navs: FundNavStatement[] = [
  { companyId: 'f1', asOfDate: '2025-09-30', reportedNav: 4_000_000, basis: 'final' },
]

describe('computeFundPositions', () => {
  it('derives contributed, distributed and unfunded — recallable restores commitment', () => {
    const [p] = computeFundPositions({ terms, events, navs, asOf: '2025-12-31' })
    expect(p.contributed).toBe(3_000_000)
    expect(p.distributed).toBe(1_200_000)
    expect(p.recallableReturned).toBe(200_000)
    // 5.0m - 3.0m called + 0.2m recallable = 2.2m still callable
    expect(p.unfunded).toBe(2_200_000)
    expect(p.pctCalled).toBeCloseTo(0.6, 10)
  })

  it('rolls the last NAV forward for cash flows after its as-of date', () => {
    const withLateCall: FundCapitalEvent[] = [
      ...events,
      { companyId: 'f1', kind: 'call', eventDate: '2025-11-15', amount: 500_000, recallableAmount: 0, charReturnOfCapital: 0, charRealizedGain: 0, charIncome: 0 },
    ]
    const [p] = computeFundPositions({ terms, events: withLateCall, navs, asOf: '2025-12-31' })
    // 4.0m reported at 2025-09-30, plus the 0.5m called after it.
    expect(p.reportedNav).toBe(4_000_000)
    expect(p.carryingValue).toBe(4_500_000)
    expect(p.navAsOf).toBe('2025-09-30')
    expect(p.stalenessDays).toBe(92)
  })

  it('subtracts distributions received after the NAV date', () => {
    const lateDist: FundCapitalEvent[] = [
      ...events,
      { companyId: 'f1', kind: 'distribution', eventDate: '2025-12-01', amount: 300_000, recallableAmount: 0, charReturnOfCapital: 300_000, charRealizedGain: 0, charIncome: 0 },
    ]
    const [p] = computeFundPositions({ terms, events: lateDist, navs, asOf: '2025-12-31' })
    expect(p.carryingValue).toBe(3_700_000)
  })

  it('ignores NAV statements struck after the reporting date', () => {
    const future = [...navs, { companyId: 'f1', asOfDate: '2026-03-31', reportedNav: 9_000_000, basis: 'final' as const }]
    const [p] = computeFundPositions({ terms, events, navs: future, asOf: '2025-12-31' })
    expect(p.reportedNav).toBe(4_000_000)
    expect(p.carryingValue).toBe(4_000_000)
  })

  it('ignores events after the reporting date', () => {
    const future: FundCapitalEvent[] = [
      ...events,
      { companyId: 'f1', kind: 'call', eventDate: '2026-02-01', amount: 900_000, recallableAmount: 0, charReturnOfCapital: 0, charRealizedGain: 0, charIncome: 0 },
    ]
    const [p] = computeFundPositions({ terms, events: future, navs, asOf: '2025-12-31' })
    expect(p.contributed).toBe(3_000_000)
    expect(p.carryingValue).toBe(4_000_000)
  })

  it('derives DPI, RVPI and TVPI off contributed capital', () => {
    const [p] = computeFundPositions({ terms, events, navs, asOf: '2025-12-31' })
    expect(p.dpi).toBeCloseTo(1_200_000 / 3_000_000, 10)
    expect(p.rvpi).toBeCloseTo(4_000_000 / 3_000_000, 10)
    expect(p.tvpi).toBeCloseTo(5_200_000 / 3_000_000, 10)
  })

  it('computes net IRR from dated flows with carrying value as the terminal inflow', () => {
    const [p] = computeFundPositions({ terms, events, navs, asOf: '2025-12-31' })
    expect(p.netIrr).not.toBeNull()
    expect(p.netIrr!).toBeGreaterThan(0.1)
    expect(p.netIrr!).toBeLessThan(0.3)
  })

  it('reports a holding with no NAV statement at cost, not at zero', () => {
    const [p] = computeFundPositions({ terms, events, navs: [], asOf: '2025-12-31' })
    // No manager statement yet: contributed less distributed is the only defensible carrying
    // value. Reporting 0 would show a total loss on a fund that has simply not reported.
    expect(p.reportedNav).toBeNull()
    expect(p.navAsOf).toBeNull()
    expect(p.carryingValue).toBe(1_800_000)
    expect(p.stalenessDays).toBeNull()
  })

  it('returns a zero position for a holding with no activity at all', () => {
    const [p] = computeFundPositions({ terms, events: [], navs: [], asOf: '2025-12-31' })
    expect(p.contributed).toBe(0)
    expect(p.carryingValue).toBe(0)
    expect(p.unfunded).toBe(5_000_000)
    expect(p.dpi).toBeNull()   // no denominator — null, never 0, never NaN
    expect(p.tvpi).toBeNull()
    expect(p.netIrr).toBeNull()
  })

  it('keeps holdings separate and returns one row per holding in input order', () => {
    const two: FundHoldingTerms[] = [
      ...terms,
      { companyId: 'f2', name: 'Beta Fund II', managerName: 'Beta', vintageYear: 2019, strategy: 'Growth', commitment: 2_000_000 },
    ]
    const rows = computeFundPositions({ terms: two, events, navs, asOf: '2025-12-31' })
    expect(rows.map(r => r.companyId)).toEqual(['f1', 'f2'])
    expect(rows[1].contributed).toBe(0)
    expect(rows[1].unfunded).toBe(2_000_000)
  })
})
