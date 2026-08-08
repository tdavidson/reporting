import type { FundPosition, NavBasis } from './fof-metrics'

/**
 * Period-end valuation for a fund of funds. Pure.
 *
 * WHY THE MARK IS DERIVED AT CLOSE rather than booked when a NAV is entered. The manager's
 * statement arrives mid-quarter and is entered then; a call notice for the same fund can
 * arrive a week later, dated before the period end. A mark computed at entry time would be
 * stale the moment that call lands. Recomputing the whole position at close — reported NAV
 * rolled forward for every cash flow since its as-of date, less what the ledger carries —
 * makes the order of arrival irrelevant.
 */

const CENT = 0.005

/**
 * How stale a manager NAV may be before the close warns. Managers report 45-90 days after
 * quarter end, so "more than one quarter, with slack for one who reports on day 95".
 * Exported because the schedule of investments flags the same threshold — two surfaces
 * disagreeing about what counts as stale is worse than either number being wrong.
 */
export const STALE_NAV_DAYS = 100

export interface PendingMark {
  companyId: string
  name: string
  periodEnd: string
  derivedCarrying: number
  ledgerCarrying: number
  /** What to book as unrealized_value_change. */
  delta: number
}

export function periodEndMarks(
  positions: FundPosition[],
  ledgerCarrying: Map<string, number>,
  periodEnd: string,
): PendingMark[] {
  const marks: PendingMark[] = []
  for (const p of positions) {
    // Absent from the ledger = carrying zero. A holding whose history was all memo-only
    // (before ledger_start_date) has no balance yet and still needs its first mark.
    const carried = ledgerCarrying.get(p.companyId) ?? 0
    const delta = p.carryingValue - carried
    if (Math.abs(delta) < CENT) continue
    marks.push({
      companyId: p.companyId,
      name: p.name,
      periodEnd,
      derivedCarrying: p.carryingValue,
      ledgerCarrying: carried,
      delta,
    })
  }
  return marks
}

export interface ValuationBasisRow {
  name: string
  navAsOf: string | null
  basis: NavBasis | 'unreported'
  stalenessDays: number | null
  carryingValue: number
  /** True when carrying value differs from the reported NAV — i.e. cash flows were rolled in. */
  rolledForward: boolean
}

/**
 * The disclosure an auditor asks for by name: which valuation each position carries, struck
 * when, on what basis, and whether we adjusted it. Generated, because a typed version of this
 * table is stale the first time a statement is restated.
 */
export function valuationBasisNote(positions: FundPosition[]): ValuationBasisRow[] {
  return positions.map(p => ({
    name: p.name,
    navAsOf: p.navAsOf,
    basis: p.navBasis ?? 'unreported',
    stalenessDays: p.stalenessDays,
    carryingValue: p.carryingValue,
    rolledForward: p.reportedNav !== null && Math.abs(p.carryingValue - p.reportedNav) >= CENT,
  }))
}

export interface ManagerStatementFigures {
  companyId: string
  reportedContributions: number | null
  reportedDistributions: number | null
  reportedUnfunded: number | null
}

export interface TieOutRow {
  name: string
  field: 'contributions' | 'distributions' | 'unfunded'
  ours: number
  theirs: number
  /** ours − theirs. Negative means the manager counts more than we do. */
  difference: number
}

/**
 * Our register against the manager's own since-inception figures. A gap on contributions is
 * almost always a call notice that never reached us — which is exactly the error a quarterly
 * close is supposed to catch and a spreadsheet never does.
 */
export function managerTieOut(
  positions: FundPosition[],
  statements: ManagerStatementFigures[],
): TieOutRow[] {
  const byCompany = new Map(statements.map(s => [s.companyId, s]))
  const rows: TieOutRow[] = []

  for (const p of positions) {
    const s = byCompany.get(p.companyId)
    if (!s) continue
    const compare = (field: TieOutRow['field'], ours: number, theirs: number | null | undefined) => {
      if (theirs === null || theirs === undefined) return   // manager did not report it
      const difference = ours - theirs
      if (Math.abs(difference) < CENT) return
      rows.push({ name: p.name, field, ours, theirs, difference })
    }
    compare('contributions', p.contributed, s.reportedContributions)
    compare('distributions', p.distributed, s.reportedDistributions)
    compare('unfunded', p.unfunded, s.reportedUnfunded)
  }
  return rows
}
