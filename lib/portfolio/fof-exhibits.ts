import type { FundPosition } from './fof-metrics'

/**
 * The three quarterly exhibits, shaped for presentation. Pure.
 *
 * NOTHING HERE RECOMPUTES A METRIC. Every figure arrives from computeFundPositions; this module
 * only selects, orders, and totals. A DPI derived in two places is a DPI that will eventually
 * disagree with itself, and the one on the LP's statement will be the wrong one.
 *
 * TOTALS ARE COMPUTED FROM TOTALS, never averaged across rows. Averaging 60% called and 100%
 * called gives 80%; the truth for a 5m-of-7m portfolio is 71.4%. Ratios of ratios are how
 * summary rows quietly lie.
 */

const CENT = 0.005
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const ratio = (num: number, den: number) => (Math.abs(den) < CENT ? null : num / den)

// ---------------------------------------------------------------------------
// Schedule of investments, fund-shaped
// ---------------------------------------------------------------------------

export interface FofSoiRow {
  companyId: string
  name: string
  vintageYear: number | null
  strategy: string | null
  commitment: number
  unfunded: number
  /** Capital in less capital returned — a fund position's remaining basis. */
  cost: number
  distributions: number
  fairValue: number
  /** null when the portfolio has no NAV to be a percentage of. */
  pctOfNav: number | null
  navAsOf: string | null
  stalenessDays: number | null
}

export function fofSoiPositions(positions: FundPosition[], totalNav: number): FofSoiRow[] {
  return positions.map(p => ({
    companyId: p.companyId,
    name: p.name,
    vintageYear: p.vintageYear,
    strategy: p.strategy,
    commitment: p.commitment,
    unfunded: p.unfunded,
    cost: p.contributed - p.distributed,
    distributions: p.distributed,
    fairValue: p.carryingValue,
    pctOfNav: ratio(p.carryingValue, totalNav),
    navAsOf: p.navAsOf,
    stalenessDays: p.stalenessDays,
  }))
}

// ---------------------------------------------------------------------------
// Commitment & liquidity
// ---------------------------------------------------------------------------

export interface CommitmentRow {
  companyId: string
  name: string
  commitment: number
  called: number
  recallableReturned: number
  unfunded: number
  pctCalled: number | null
}

export interface CommitmentSchedule {
  rows: CommitmentRow[]
  totals: {
    commitment: number
    called: number
    recallableReturned: number
    unfunded: number
    pctCalled: number | null
  }
  cash: number
  /** cash / unfunded. null when nothing is unfunded — not Infinity. */
  coverage: number | null
}

export function commitmentSchedule(positions: FundPosition[], cash: number): CommitmentSchedule {
  const rows: CommitmentRow[] = positions
    .map(p => ({
      companyId: p.companyId,
      name: p.name,
      commitment: p.commitment,
      called: p.contributed,
      recallableReturned: p.recallableReturned,
      unfunded: p.unfunded,
      pctCalled: p.pctCalled,
    }))
    // Largest unfunded first: the question this exhibit answers is "what can be called on me".
    .sort((a, b) => b.unfunded - a.unfunded || a.name.localeCompare(b.name))

  const commitment = sum(rows.map(r => r.commitment))
  const called = sum(rows.map(r => r.called))
  const unfunded = sum(rows.map(r => r.unfunded))

  return {
    rows,
    totals: {
      commitment,
      called,
      recallableReturned: sum(rows.map(r => r.recallableReturned)),
      unfunded,
      pctCalled: ratio(called, commitment),
    },
    cash,
    coverage: ratio(cash, unfunded),
  }
}

// ---------------------------------------------------------------------------
// Underlying fund performance
// ---------------------------------------------------------------------------

export interface PerformanceRow {
  companyId: string
  name: string
  vintageYear: number | null
  commitment: number
  contributed: number
  distributed: number
  nav: number
  dpi: number | null
  rvpi: number | null
  tvpi: number | null
  netIrr: number | null
}

export interface PerformanceTable {
  rows: PerformanceRow[]
  /**
   * No netIrr, deliberately. A portfolio IRR is not the sum or the average of position IRRs —
   * it needs the combined dated cash flows, which is fund-level net IRR and already exists in
   * the metrics module. Publishing an averaged IRR here would be simply wrong.
   */
  totals: {
    commitment: number
    contributed: number
    distributed: number
    nav: number
    dpi: number | null
    rvpi: number | null
    tvpi: number | null
  }
}

export function performanceTable(positions: FundPosition[]): PerformanceTable {
  const rows: PerformanceRow[] = positions
    .map(p => ({
      companyId: p.companyId,
      name: p.name,
      vintageYear: p.vintageYear,
      commitment: p.commitment,
      contributed: p.contributed,
      distributed: p.distributed,
      nav: p.carryingValue,
      dpi: p.dpi,
      rvpi: p.rvpi,
      tvpi: p.tvpi,
      netIrr: p.netIrr,
    }))
    // A holding with no vintage sorts LAST, not first — 9999 rather than 0.
    .sort((a, b) => (a.vintageYear ?? 9999) - (b.vintageYear ?? 9999) || a.name.localeCompare(b.name))

  const contributed = sum(rows.map(r => r.contributed))
  const distributed = sum(rows.map(r => r.distributed))
  const nav = sum(rows.map(r => r.nav))

  return {
    rows,
    totals: {
      commitment: sum(rows.map(r => r.commitment)),
      contributed,
      distributed,
      nav,
      dpi: ratio(distributed, contributed),
      rvpi: ratio(nav, contributed),
      tvpi: ratio(distributed + nav, contributed),
    },
  }
}
