/**
 * Shared LP-portal overview aggregation. Turns raw lp_investments rows (across
 * snapshots) into a dashboard summary: the totals + per-vehicle breakdown for
 * the single most recent snapshot. Used by both the live portal
 * (/api/portal/overview) and the GP "view as LP" preview so they stay identical.
 */

export interface OverviewVehicle {
  name: string
  commitment: number
  called: number
  distributed: number
  nav: number
  dpi: number | null
  tvpi: number | null
}

export interface OverviewTotals {
  commitment: number
  called: number
  distributed: number
  nav: number
  dpi: number | null
  tvpi: number | null
}

export interface OverviewMetrics {
  asOfDate: string | null
  snapshotName: string | null
  totals: OverviewTotals
  vehicles: OverviewVehicle[]
}

export interface OverviewInvestmentRow {
  portfolio_group: string | null
  commitment: number | string | null
  paid_in_capital: number | string | null
  called_capital: number | string | null
  distributions: number | string | null
  nav: number | string | null
  total_value: number | string | null
  snapshot_id: string | null
  lp_snapshots?: { id: string; name: string | null; as_of_date: string | null } | null
}

// Postgres numerics can arrive as strings; coerce defensively.
const num = (x: number | string | null | undefined): number => {
  const n = typeof x === 'number' ? x : parseFloat(String(x ?? ''))
  return Number.isFinite(n) ? n : 0
}
const ratio = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? numerator / denominator : null

/**
 * Build the overview from investment rows (each row = one entity's position in
 * one vehicle in one snapshot). Picks the most recent snapshot by as_of_date,
 * then sums each metric per vehicle (portfolio_group) and overall. Returns null
 * when there are no rows.
 */
export function buildOverview(rows: OverviewInvestmentRow[]): OverviewMetrics | null {
  if (!rows.length) return null

  // Group by snapshot, then choose the latest by as_of_date (null dates sort oldest).
  const bySnapshot = new Map<string, { asOf: string | null; name: string | null; rows: OverviewInvestmentRow[] }>()
  for (const r of rows) {
    const sid = r.snapshot_id ?? r.lp_snapshots?.id ?? 'none'
    let entry = bySnapshot.get(sid)
    if (!entry) {
      entry = { asOf: r.lp_snapshots?.as_of_date ?? null, name: r.lp_snapshots?.name ?? null, rows: [] }
      bySnapshot.set(sid, entry)
    }
    entry.rows.push(r)
  }

  let latest: { asOf: string | null; name: string | null; rows: OverviewInvestmentRow[] } | null = null
  for (const entry of Array.from(bySnapshot.values())) {
    if (!latest || (entry.asOf ?? '').localeCompare(latest.asOf ?? '') > 0) latest = entry
  }
  if (!latest) return null

  const called = (r: OverviewInvestmentRow) => (r.called_capital != null ? num(r.called_capital) : num(r.paid_in_capital))
  const navOf = (r: OverviewInvestmentRow) => (r.nav != null ? num(r.nav) : num(r.total_value))

  const vehicleMap = new Map<string, OverviewVehicle>()
  const totals: OverviewTotals = { commitment: 0, called: 0, distributed: 0, nav: 0, dpi: null, tvpi: null }

  for (const r of latest.rows) {
    const key = (r.portfolio_group ?? '').trim() || 'Investment'
    let v = vehicleMap.get(key)
    if (!v) {
      v = { name: key, commitment: 0, called: 0, distributed: 0, nav: 0, dpi: null, tvpi: null }
      vehicleMap.set(key, v)
    }
    const c = num(r.commitment), cl = called(r), d = num(r.distributions), n = navOf(r)
    v.commitment += c; v.called += cl; v.distributed += d; v.nav += n
    totals.commitment += c; totals.called += cl; totals.distributed += d; totals.nav += n
  }

  for (const v of Array.from(vehicleMap.values())) {
    v.dpi = ratio(v.distributed, v.called)
    v.tvpi = ratio(v.distributed + v.nav, v.called)
  }
  totals.dpi = ratio(totals.distributed, totals.called)
  totals.tvpi = ratio(totals.distributed + totals.nav, totals.called)

  const vehicles = Array.from(vehicleMap.values()).sort((a, b) => b.commitment - a.commitment)
  return { asOfDate: latest.asOf, snapshotName: latest.name, totals, vehicles }
}
