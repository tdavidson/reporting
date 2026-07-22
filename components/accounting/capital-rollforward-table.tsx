'use client'

// The read-only statement of changes in partners' capital — the per-LP roll-forward table shared by
// the accounting capital-accounts page and the LP-tracking surface. Fed by
// /api/accounting/capital-accounts for BOTH producers (posted ledger and pasted positions); the
// drop-zero columns mean a pasting vehicle naturally shows only Beginning / Contributions /
// Distributions / a value-change column / Ending, while the fee/carry/realized columns (which only a
// ledger vehicle populates) simply don't appear.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { SortTh, nextSort, compareVals, type SortState } from '@/components/sortable-th'
import { type PeriodPreset } from '@/lib/accounting/statement-period'

export interface Account {
  beginning: number
  contributions: number
  distributions: number
  managementFees: number
  expenses: number
  operatingIncome: number
  realizedGains: number
  unrealizedGains: number
  fxTranslation: number
  transfers: number
  carriedInterest: number
  unclassified: number
  ending: number
}

export interface Row extends Account {
  lpEntityId: string
  name: string
  partnerClass: string
  commitment: number
  called: number
  funded: number
  outstanding: number
  receivable: number
  period: Account | null
  itd: Account
}

export const COMMITMENT_COLUMNS: { key: 'commitment' | 'called' | 'funded' | 'outstanding' | 'receivable'; label: string }[] = [
  { key: 'commitment', label: 'Committed' },
  { key: 'called', label: 'Called' },
  { key: 'funded', label: 'Funded' },
  { key: 'outstanding', label: 'Remaining to be called' },
  { key: 'receivable', label: 'Called, unpaid' },
]

export const COLUMNS: { key: keyof Account; label: string }[] = [
  { key: 'beginning', label: 'Beginning' },
  { key: 'contributions', label: 'Contributions' },
  { key: 'distributions', label: 'Distributions' },
  { key: 'managementFees', label: 'Mgmt fees' },
  { key: 'expenses', label: 'Partnership exp.' },
  { key: 'operatingIncome', label: 'Operating income' },
  { key: 'realizedGains', label: 'Net realized G/(L)' },
  { key: 'unrealizedGains', label: 'Net unrealized G/(L)' },
  // A currency swing is not investment performance — its own column, so a partner can see how the
  // portfolio did apart from what the exchange rate did to it.
  { key: 'fxTranslation', label: 'FX translation' },
  { key: 'transfers', label: 'Transfers' },
  { key: 'carriedInterest', label: 'Carry accrued' },
  { key: 'unclassified', label: 'Unclassified' },
  { key: 'ending', label: 'Ending' },
]

export function CapitalRollforwardTable({
  rows,
  scope,
  fmt,
  lpHref,
}: {
  rows: Row[]
  /** Which account to show per row: the period-scoped roll-forward, or ITD. */
  scope: { preset: PeriodPreset; start?: string | null }
  fmt: (v: number) => string
  /** Per-LP drilldown link; omit to render the partner name as plain text (the LP-tracking surface
   *  has no per-LP page). */
  lpHref?: (lpEntityId: string) => string
}) {
  // Values shown are scoped to the selected period; ITD is the whole history.
  const acctOf = (r: Row): Account => (scope.preset === 'itd' ? r.itd : r.period ?? r.itd)

  // Drop lines that are zero for every partner — a clean set of books should never show an
  // "Unclassified" column, but it has to appear the moment something lands there.
  const columns = useMemo(
    () => COLUMNS.filter(c =>
      c.key === 'beginning' || c.key === 'ending' ||
      rows.some(r => Math.abs(acctOf(r)[c.key]) > 0.004)
    ),
    [rows, scope], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const commitmentCols = useMemo(
    () => COMMITMENT_COLUMNS.filter(c => c.key !== 'receivable' || rows.some(r => Math.abs(r.receivable) > 0.004)),
    [rows],
  )

  // Sortable headers. Account columns are period-scoped (acctOf); commitment columns are not.
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' })
  const onSort = (key: string) => setSort(s => nextSort(s, key, key === 'name' ? 'asc' : 'desc'))
  const sortedRows = useMemo(() => {
    const accountKeys = new Set<string>(COLUMNS.map(c => c.key))
    const val = (r: Row): number | string => {
      if (sort.key === 'name') return r.name
      if (accountKeys.has(sort.key)) return acctOf(r)[sort.key as keyof Account]
      return (r as any)[sort.key] ?? 0
    }
    return [...rows].sort((a, b) => compareVals(val(a), val(b), sort.dir))
  }, [rows, sort, scope]) // eslint-disable-line react-hooks/exhaustive-deps

  const totals = columns.reduce((acc, c) => {
    acc[c.key] = rows.reduce((s, r) => s + acctOf(r)[c.key], 0)
    return acc
  }, {} as Record<string, number>)
  const commitTotals = commitmentCols.reduce((acc, c) => {
    acc[c.key] = rows.reduce((s, r) => s + r[c.key], 0)
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="border rounded-lg overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead>
          <tr className="border-b bg-muted/50">
            <SortTh label="Partner" sortKey="name" sort={sort} onSort={onSort} align="left" />
            {/* Commitment side — was the Capital calls page. */}
            {commitmentCols.map(c => <SortTh key={c.key} label={c.label} sortKey={c.key} sort={sort} onSort={onSort} align="right" className="border-l" />)}
            {columns.map((c, i) => <SortTh key={c.key} label={c.label} sortKey={c.key} sort={sort} onSort={onSort} align="right" className={i === 0 ? 'border-l' : ''} />)}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(r => {
            const a = acctOf(r)
            const href = lpHref?.(r.lpEntityId)
            return (
              <tr key={r.lpEntityId} className="border-b last:border-b-0 hover:bg-muted/30">
                <td className="px-3 py-2 max-w-[200px]">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {href
                      ? <Link href={href} className="hover:underline truncate" title={r.name}>{r.name}</Link>
                      : <span className="truncate" title={r.name}>{r.name}</span>}
                    {r.partnerClass === 'gp' && <span className="text-[10px] uppercase tracking-wider px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0">GP</span>}
                  </div>
                </td>
                {commitmentCols.map(c => (
                  <td key={c.key} className={`px-3 py-2 text-right font-mono border-l ${Math.abs(r[c.key]) > 0.004 ? '' : 'text-muted-foreground'}`}>
                    {fmt(r[c.key])}
                  </td>
                ))}
                {columns.map((c, i) => (
                  <td key={c.key} className={`px-3 py-2 text-right font-mono ${i === 0 ? 'border-l' : ''} ${c.key === 'ending' ? 'font-semibold' : ''} ${c.key === 'unclassified' && Math.abs(a[c.key]) > 0.004 ? 'text-amber-600' : ''}`}>
                    {/* Roll-forward deltas are signed so the columns tie to Ending: contributions add,
                        distributions (withdrawals) and fees subtract. */}
                    {fmt(a[c.key])}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t bg-muted/30 font-semibold">
            <td className="px-3 py-2">Total</td>
            {commitmentCols.map(c => <td key={c.key} className="px-3 py-2 text-right font-mono border-l">{fmt(commitTotals[c.key])}</td>)}
            {columns.map((c, i) => <td key={c.key} className={`px-3 py-2 text-right font-mono ${i === 0 ? 'border-l' : ''}`}>{fmt(totals[c.key])}</td>)}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
