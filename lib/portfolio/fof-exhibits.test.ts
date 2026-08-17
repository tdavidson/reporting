import { describe, it, expect } from 'vitest'
import { fofSoiPositions, commitmentSchedule, performanceTable } from './fof-exhibits'
import type { FundPosition } from './fof-metrics'

const pos = (over: Partial<FundPosition>): FundPosition => ({
  companyId: 'f1', name: 'Acme Ventures III', managerName: 'Acme', vintageYear: 2021,
  strategy: 'Early stage', commitment: 5_000_000, contributed: 3_000_000, distributed: 1_200_000,
  recallableReturned: 200_000, unfunded: 2_200_000, pctCalled: 0.6,
  reportedNav: 4_000_000, navAsOf: '2025-09-30', navBasis: 'final', stalenessDays: 92,
  carryingValue: 4_000_000,
  dpi: 0.4, rvpi: 1.333333, tvpi: 1.733333, netIrr: 0.18,
  ...over,
})

const TWO = [
  pos({}),
  pos({ companyId: 'f2', name: 'Beta Growth II', vintageYear: 2019, strategy: 'Growth',
        commitment: 2_000_000, contributed: 2_000_000, distributed: 3_000_000, recallableReturned: 0,
        unfunded: 0, pctCalled: 1, reportedNav: 1_000_000, carryingValue: 1_000_000,
        dpi: 1.5, rvpi: 0.5, tvpi: 2, netIrr: 0.25 }),
]

describe('fofSoiPositions', () => {
  it('shapes a position as an SOI row with percent of NAV', () => {
    const rows = fofSoiPositions(TWO, 5_000_000)
    expect(rows[0]).toMatchObject({
      name: 'Acme Ventures III', vintageYear: 2021, strategy: 'Early stage',
      commitment: 5_000_000, unfunded: 2_200_000, fairValue: 4_000_000,
      navAsOf: '2025-09-30', stalenessDays: 92,
    })
    expect(rows[0].pctOfNav).toBeCloseTo(0.8, 10)
    expect(rows[1].pctOfNav).toBeCloseTo(0.2, 10)
  })

  it('has percentages that sum to one across the portfolio', () => {
    const rows = fofSoiPositions(TWO, TWO.reduce((a, p) => a + p.carryingValue, 0))
    expect(rows.reduce((a, r) => a + (r.pctOfNav ?? 0), 0)).toBeCloseTo(1, 10)
  })

  it('reports cost as contributed less distributed return of capital', () => {
    // Cost for a fund position is capital in, less capital returned — not gross contributions.
    const rows = fofSoiPositions([pos({})], 5_000_000)
    expect(rows[0].cost).toBe(1_800_000)
  })

  it('returns null percent of NAV when total NAV is zero rather than dividing by zero', () => {
    const rows = fofSoiPositions([pos({})], 0)
    expect(rows[0].pctOfNav).toBeNull()
  })
})

describe('commitmentSchedule', () => {
  it('totals commitment, called, recallable and unfunded across holdings', () => {
    const s = commitmentSchedule(TWO, 1_100_000)
    expect(s.totals).toMatchObject({
      commitment: 7_000_000, called: 5_000_000, recallableReturned: 200_000, unfunded: 2_200_000,
    })
  })

  it('computes total percent called from the totals, not by averaging the rows', () => {
    // Averaging 60% and 100% gives 80%; the truth is 5.0m/7.0m = 71.4%. A fund board reads
    // this number, so it has to be the real one.
    const s = commitmentSchedule(TWO, 0)
    expect(s.totals.pctCalled).toBeCloseTo(5_000_000 / 7_000_000, 10)
  })

  it('reports coverage as cash over unfunded', () => {
    const s = commitmentSchedule(TWO, 1_100_000)
    expect(s.coverage).toBeCloseTo(0.5, 10)
  })

  it('reports coverage as null, not Infinity, when nothing is unfunded', () => {
    const fully = [pos({ unfunded: 0, commitment: 3_000_000, contributed: 3_000_000, recallableReturned: 0 })]
    expect(commitmentSchedule(fully, 500_000).coverage).toBeNull()
  })

  it('reports zero coverage — not null — when there is unfunded commitment and no cash', () => {
    // No cash against a real obligation is a real answer, and a dash would hide it.
    expect(commitmentSchedule(TWO, 0).coverage).toBe(0)
  })

  it('orders rows by unfunded commitment, largest first', () => {
    // The liquidity question is "what can be called on me", so the biggest exposure leads.
    const s = commitmentSchedule(TWO, 0)
    expect(s.rows.map(r => r.name)).toEqual(['Acme Ventures III', 'Beta Growth II'])
  })
})

describe('performanceTable', () => {
  it('carries per-fund metrics through unchanged', () => {
    const t = performanceTable(TWO)
    expect(t.rows.find(r => r.name === 'Acme Ventures III')).toMatchObject({
      dpi: 0.4, tvpi: 1.733333, netIrr: 0.18,
    })
  })

  it('computes total ratios from total flows, not by averaging', () => {
    const t = performanceTable(TWO)
    expect(t.totals.contributed).toBe(5_000_000)
    expect(t.totals.distributed).toBe(4_200_000)
    expect(t.totals.nav).toBe(5_000_000)
    expect(t.totals.dpi).toBeCloseTo(4_200_000 / 5_000_000, 10)
    expect(t.totals.tvpi).toBeCloseTo(9_200_000 / 5_000_000, 10)
  })

  it('has no total net IRR', () => {
    // A portfolio IRR is NOT the sum or average of position IRRs — it needs the combined
    // dated cash flows, which is fund-level net IRR and already lives in the metrics module.
    expect('netIrr' in performanceTable(TWO).totals).toBe(false)
  })

  it('orders by vintage year then name', () => {
    const t = performanceTable(TWO)
    expect(t.rows.map(r => r.vintageYear)).toEqual([2019, 2021])
  })

  it('sorts a holding with no vintage year last rather than first', () => {
    const t = performanceTable([pos({ companyId: 'f3', name: 'Zed', vintageYear: null }), ...TWO])
    expect(t.rows[t.rows.length - 1].name).toBe('Zed')
  })

  it('leaves ratios null for a holding with no contributions', () => {
    const t = performanceTable([pos({ contributed: 0, distributed: 0, carryingValue: 0, dpi: null, rvpi: null, tvpi: null, netIrr: null })])
    expect(t.rows[0].tvpi).toBeNull()
    expect(t.totals.tvpi).toBeNull()
  })
})
