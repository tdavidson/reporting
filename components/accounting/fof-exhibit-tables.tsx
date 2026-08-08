'use client'

import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCurrency, formatCurrency } from '@/components/currency-context'

/** Kept in step with STALE_NAV_DAYS in lib/portfolio/fof-valuation.ts. */
const STALE_DAYS = 100
const DASH = '—'

const pct = (v: number | null | undefined) => (v === null || v === undefined ? DASH : `${(v * 100).toFixed(1)}%`)
const mult = (v: number | null | undefined) => (v === null || v === undefined ? DASH : `${v.toFixed(2)}x`)

export interface SoiRow {
  companyId: string; name: string; vintageYear: number | null; strategy: string | null
  commitment: number; unfunded: number; cost: number; distributions: number; fairValue: number
  pctOfNav: number | null; navAsOf: string | null; stalenessDays: number | null
}

export interface CommitmentSchedule {
  rows: { companyId: string; name: string; commitment: number; called: number; recallableReturned: number; unfunded: number; pctCalled: number | null }[]
  totals: { commitment: number; called: number; recallableReturned: number; unfunded: number; pctCalled: number | null }
  cash: number
  coverage: number | null
}

export interface PerformanceTable {
  rows: { companyId: string; name: string; vintageYear: number | null; commitment: number; contributed: number; distributed: number; nav: number; dpi: number | null; rvpi: number | null; tvpi: number | null; netIrr: number | null }[]
  totals: { commitment: number; contributed: number; distributed: number; nav: number; dpi: number | null; rvpi: number | null; tvpi: number | null }
}

/** One grouping function, keyed however the caller wants — vintage or strategy. */
function groupBy<T>(rows: T[], key: (r: T) => string): { label: string; rows: T[] }[] {
  const map = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(r)
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, rs]) => ({ label, rows: rs }))
}

export function FofSoiTable({ rows, groupMode }: { rows: SoiRow[]; groupMode: 'vintage' | 'strategy' }) {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrency(v, currency)
  if (rows.length === 0) return null

  const groups = groupBy(rows, r =>
    groupMode === 'vintage' ? String(r.vintageYear ?? 'No vintage') : (r.strategy ?? 'No strategy'))

  const total = (rs: SoiRow[], f: (r: SoiRow) => number) => rs.reduce((a, r) => a + f(r), 0)

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Fund</TableHead>
          <TableHead className="text-right">Commitment</TableHead>
          <TableHead className="text-right">Unfunded</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead className="text-right">Distributions</TableHead>
          <TableHead className="text-right">Fair value</TableHead>
          <TableHead className="text-right">% of NAV</TableHead>
          <TableHead>NAV as of</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map(g => (
          <>
            <TableRow key={`h-${g.label}`}>
              <TableCell colSpan={8} className="font-medium bg-muted/40">{g.label}</TableCell>
            </TableRow>
            {g.rows.map(r => (
              <TableRow key={r.companyId}>
                <TableCell className="pl-6">{r.name}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(r.commitment)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(r.unfunded)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(r.cost)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(r.distributions)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(r.fairValue)}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(r.pctOfNav)}</TableCell>
                <TableCell className="tabular-nums text-sm">
                  {r.navAsOf ?? <span className="text-muted-foreground">None</span>}
                  {r.stalenessDays !== null && r.stalenessDays > STALE_DAYS && (
                    <span className="block text-warning">{r.stalenessDays}d stale</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            <TableRow key={`t-${g.label}`}>
              <TableCell className="pl-6 text-sm text-muted-foreground">{g.label} total</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(total(g.rows, r => r.commitment))}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(total(g.rows, r => r.unfunded))}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(total(g.rows, r => r.cost))}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(total(g.rows, r => r.distributions))}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(total(g.rows, r => r.fairValue))}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(total(g.rows, r => r.pctOfNav ?? 0))}</TableCell>
              <TableCell />
            </TableRow>
          </>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell className="font-medium">Total</TableCell>
          <TableCell className="text-right tabular-nums">{fmt(total(rows, r => r.commitment))}</TableCell>
          <TableCell className="text-right tabular-nums">{fmt(total(rows, r => r.unfunded))}</TableCell>
          <TableCell className="text-right tabular-nums">{fmt(total(rows, r => r.cost))}</TableCell>
          <TableCell className="text-right tabular-nums">{fmt(total(rows, r => r.distributions))}</TableCell>
          <TableCell className="text-right tabular-nums">{fmt(total(rows, r => r.fairValue))}</TableCell>
          <TableCell className="text-right tabular-nums">{pct(total(rows, r => r.pctOfNav ?? 0))}</TableCell>
          <TableCell />
        </TableRow>
      </TableFooter>
    </Table>
  )
}

export function FofCommitmentTable({ schedule }: { schedule: CommitmentSchedule }) {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrency(v, currency)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        <span>Cash <span className="tabular-nums font-medium">{fmt(schedule.cash)}</span></span>
        <span>Unfunded <span className="tabular-nums font-medium">{fmt(schedule.totals.unfunded)}</span></span>
        <span>
          Coverage{' '}
          <span className="tabular-nums font-medium">
            {/* Fully drawn is a real state, not a missing number. */}
            {schedule.coverage === null ? 'Fully drawn — no unfunded commitment' : pct(schedule.coverage)}
          </span>
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fund</TableHead>
            <TableHead className="text-right">Commitment</TableHead>
            <TableHead className="text-right">Called</TableHead>
            <TableHead className="text-right">Recallable returned</TableHead>
            <TableHead className="text-right">Unfunded</TableHead>
            <TableHead className="text-right">% called</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {schedule.rows.map(r => (
            <TableRow key={r.companyId}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(r.commitment)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(r.called)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(r.recallableReturned)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(r.unfunded)}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(r.pctCalled)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          {/* Rendered from the PROVIDED totals — summing the rows here would lose the
              computed-from-totals property the exhibit module guarantees. */}
          <TableRow>
            <TableCell className="font-medium">Total</TableCell>
            <TableCell className="text-right tabular-nums">{fmt(schedule.totals.commitment)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmt(schedule.totals.called)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmt(schedule.totals.recallableReturned)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmt(schedule.totals.unfunded)}</TableCell>
            <TableCell className="text-right tabular-nums">{pct(schedule.totals.pctCalled)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  )
}

export function FofPerformanceTable({ table }: { table: PerformanceTable }) {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrency(v, currency)

  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fund</TableHead>
            <TableHead className="text-right">Vintage</TableHead>
            <TableHead className="text-right">Commitment</TableHead>
            <TableHead className="text-right">Contributed</TableHead>
            <TableHead className="text-right">Distributed</TableHead>
            <TableHead className="text-right">NAV</TableHead>
            <TableHead className="text-right">DPI</TableHead>
            <TableHead className="text-right">RVPI</TableHead>
            <TableHead className="text-right">TVPI</TableHead>
            <TableHead className="text-right">Net IRR</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.map(r => (
            <TableRow key={r.companyId}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell className="text-right tabular-nums">{r.vintageYear ?? DASH}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(r.commitment)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(r.contributed)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(r.distributed)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(r.nav)}</TableCell>
              <TableCell className="text-right tabular-nums">{mult(r.dpi)}</TableCell>
              <TableCell className="text-right tabular-nums">{mult(r.rvpi)}</TableCell>
              <TableCell className="text-right tabular-nums">{mult(r.tvpi)}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(r.netIrr)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-medium">Total</TableCell>
            <TableCell />
            <TableCell className="text-right tabular-nums">{fmt(table.totals.commitment)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmt(table.totals.contributed)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmt(table.totals.distributed)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmt(table.totals.nav)}</TableCell>
            <TableCell className="text-right tabular-nums">{mult(table.totals.dpi)}</TableCell>
            <TableCell className="text-right tabular-nums">{mult(table.totals.rvpi)}</TableCell>
            <TableCell className="text-right tabular-nums">{mult(table.totals.tvpi)}</TableCell>
            <TableCell className="text-right tabular-nums">{DASH}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      <p className="text-sm text-muted-foreground">
        A portfolio-level IRR requires combined cash flows and is reported as the fund&rsquo;s net
        IRR — it is not an average of the per-fund figures above.
      </p>
    </div>
  )
}
