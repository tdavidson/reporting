'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { useCurrency, getCurrencySymbol } from '@/components/currency-context'
import { ChevronUp, ChevronDown, ChevronsUpDown, X } from 'lucide-react'

interface ManagementRow {
  companyId: string
  name: string
  logoUrl: string | null
  stage: string | null
  status: string
  portfolioGroup: string[]
  ownershipPct: number | null
  entryOwnershipPct: number | null
  capitalInvested: number | null
  entryValuation: number | null
  currentValuation: number | null
  moic: number | null
  evRevenue: number | null
  mrr: number | null
  mrrGrowth: number | null
  cash: number | null
  burn: number | null
  runway: number | null
  lastUpdateAt: string | null
}

const STAGE_ORDER = ['Pre-Seed', 'Seed', 'Series A', 'Series B', 'Series C', 'Growth', 'IPO track']

const STAGE_COLORS: Record<string, { bg: string; text: string }> = {
  'Pre-Seed': { bg: 'bg-sky-100 dark:bg-sky-950',    text: 'text-sky-700 dark:text-sky-400' },
  'Seed':     { bg: 'bg-sky-200 dark:bg-sky-900',    text: 'text-sky-700 dark:text-sky-300' },
  'Series A': { bg: 'bg-blue-200 dark:bg-blue-900',  text: 'text-blue-700 dark:text-blue-300' },
  'Series B': { bg: 'bg-blue-300 dark:bg-blue-800',  text: 'text-blue-800 dark:text-blue-200' },
  'Series C': { bg: 'bg-indigo-300 dark:bg-indigo-800', text: 'text-indigo-800 dark:text-indigo-200' },
  'Growth':   { bg: 'bg-indigo-400 dark:bg-indigo-700', text: 'text-indigo-900 dark:text-indigo-100' },
  'IPO track':{ bg: 'bg-violet-500 dark:bg-violet-600', text: 'text-white' },
}

function stageBadge(stage: string | null) {
  if (!stage) return <span className="text-muted-foreground/40 text-xs">—</span>
  const c = STAGE_COLORS[stage] ?? { bg: 'bg-blue-100 dark:bg-blue-900', text: 'text-blue-700 dark:text-blue-300' }
  return <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${c.bg} ${c.text}`}>{stage}</Badge>
}

function statusBadge(status: string) {
  if (status === 'exited')      return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">Exited</Badge>
  if (status === 'written-off') return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">Written Off</Badge>
  return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">Active</Badge>
}

/**
 * Format a number with up to 2 significant decimals + thousands comma.
 * Examples:
 *   1_234_567_890  → "$1.23B"
 *   1_500_000      → "$1.5M"
 *   1_200_000      → "$1.2M"
 *   1_000_000      → "$1M"
 *  12_345          → "$12,345"
 *   1_234          → "$1,234"
 *     500          → "$500"
 */
function fmtCurrency(value: number | null, symbol: string): string {
  if (value == null) return '—'
  const abs = Math.abs(value)
  const neg = value < 0 ? '-' : ''

  if (abs >= 1_000_000_000) {
    const n = abs / 1_000_000_000
    const str = n % 1 === 0
      ? n.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
    return `${neg}${symbol}${str}B`
  }

  if (abs >= 1_000_000) {
    const n = abs / 1_000_000
    const str = n % 1 === 0
      ? n.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
    return `${neg}${symbol}${str}M`
  }

  if (abs >= 1_000) {
    const n = abs / 1_000
    const str = n % 1 === 0
      ? n.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    return `${neg}${symbol}${str}K`
  }

  return `${neg}${symbol}${Math.round(abs).toLocaleString('en-US')}`
}

function fmt(value: number | null, type: 'pct' | 'multiple' | 'months'): string {
  if (value == null) return '—'
  switch (type) {
    case 'pct':      return `${(value * 100).toFixed(1)}%`
    case 'multiple': return `${value.toFixed(2)}x`
    case 'months':   return `${value}mo`
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// col index of the last column in each section (used for right-border dividers)
const SECTION_LAST_COL_INDICES = new Set([2, 5, 9, 14])
// col index 0 = Name  → only this column is sticky
const NAME_COL_IDX = 0

interface SectionHeader { label: string; colSpan: number }
interface ColDef {
  key: string
  label: string
  sortValue: (row: ManagementRow) => number | string | null
  render: (row: ManagementRow, symbol: string) => React.ReactNode
}

const SECTION_HEADERS: SectionHeader[] = [
  { label: 'Company',       colSpan: 3 },
  { label: '💼 Investment',  colSpan: 3 },
  { label: '📈 Valuation',   colSpan: 4 },
  { label: '📊 Operations',  colSpan: 5 },
  { label: '🗓 Activity',    colSpan: 1 },
]

const COLUMNS: ColDef[] = [
  {
    key: 'name', label: 'Name',
    sortValue: (row) => row.name,
    render: (row) => (
      <Link href={`/companies/${row.companyId}`} className="flex items-center gap-2 hover:underline font-medium">
        <span className="truncate max-w-[140px]">{row.name}</span>
      </Link>
    ),
  },
  {
    key: 'stage', label: 'Stage',
    sortValue: (row) => row.stage ?? '',
    render: (row) => stageBadge(row.stage),
  },
  {
    key: 'status', label: 'Status',
    sortValue: (row) => row.status,
    render: (row) => statusBadge(row.status),
  },
  {
    key: 'entryOwnershipPct', label: 'Entry Own.%',
    sortValue: (row) => row.entryOwnershipPct,
    render: (row) => <span className="tabular-nums">{fmt(row.entryOwnershipPct != null ? row.entryOwnershipPct / 100 : null, 'pct')}</span>,
  },
  {
    key: 'ownershipPct', label: 'Current Own.%',
    sortValue: (row) => row.ownershipPct,
    render: (row) => <span className="tabular-nums">{fmt(row.ownershipPct != null ? row.ownershipPct / 100 : null, 'pct')}</span>,
  },
  {
    key: 'capitalInvested', label: 'Invested',
    sortValue: (row) => row.capitalInvested,
    render: (row, sym) => <span className="tabular-nums">{fmtCurrency(row.capitalInvested, sym)}</span>,
  },
  {
    key: 'entryValuation', label: 'Entry Val.',
    sortValue: (row) => row.entryValuation,
    render: (row, sym) => <span className="tabular-nums">{fmtCurrency(row.entryValuation, sym)}</span>,
  },
  {
    key: 'currentValuation', label: 'Current Val.',
    sortValue: (row) => row.currentValuation,
    render: (row, sym) => <span className="tabular-nums">{fmtCurrency(row.currentValuation, sym)}</span>,
  },
  {
    key: 'moic', label: 'MOIC',
    sortValue: (row) => row.moic,
    render: (row) => (
      <span className={`tabular-nums font-medium ${
        row.moic != null && row.moic >= 2 ? 'text-green-600 dark:text-green-400' :
        row.moic != null && row.moic < 1  ? 'text-red-500 dark:text-red-400' : ''
      }`}>
        {fmt(row.moic, 'multiple')}
      </span>
    ),
  },
  {
    key: 'evRevenue', label: 'EV/Rev (ARR)',
    sortValue: (row) => row.evRevenue,
    render: (row) => <span className="tabular-nums">{fmt(row.evRevenue, 'multiple')}</span>,
  },
  {
    key: 'mrr', label: 'MRR',
    sortValue: (row) => row.mrr,
    render: (row, sym) => <span className="tabular-nums">{fmtCurrency(row.mrr, sym)}</span>,
  },
  {
    key: 'mrrGrowth', label: 'MRR MoM',
    sortValue: (row) => row.mrrGrowth,
    render: (row) => {
      if (row.mrrGrowth == null) return <span className="text-muted-foreground/40">—</span>
      const pct = row.mrrGrowth * 100
      const isPos = pct > 0
      return (
        <span className={`tabular-nums font-medium ${
          isPos ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'
        }`}>
          {isPos ? '+' : ''}{pct.toFixed(1)}%
        </span>
      )
    },
  },
  {
    key: 'cash', label: 'Cash',
    sortValue: (row) => row.cash,
    render: (row, sym) => <span className="tabular-nums">{fmtCurrency(row.cash, sym)}</span>,
  },
  {
    key: 'burn', label: 'Burn/mo',
    sortValue: (row) => row.burn,
    render: (row, sym) => <span className="tabular-nums">{fmtCurrency(row.burn, sym)}</span>,
  },
  {
    key: 'runway', label: 'Runway',
    sortValue: (row) => row.runway,
    render: (row) => {
      if (row.runway == null) return <span className="text-muted-foreground/40">—</span>
      const color = row.runway <= 3 ? 'text-red-500 dark:text-red-400' :
                    row.runway <= 6 ? 'text-amber-500 dark:text-amber-400' :
                    'text-green-600 dark:text-green-400'
      return <span className={`tabular-nums font-medium ${color}`}>{row.runway}mo</span>
    },
  },
  {
    key: 'lastUpdateAt', label: 'Last Update',
    sortValue: (row) => row.lastUpdateAt ?? '',
    render: (row) => <span className="text-muted-foreground text-xs">{fmtDate(row.lastUpdateAt)}</span>,
  },
]

const STATUS_OPTIONS = [
  { value: 'active',      label: 'Active' },
  { value: 'exited',      label: 'Exited' },
  { value: 'written-off', label: 'Written Off' },
]

type SortDir = 'asc' | 'desc' | null

interface Props {
  allGroups: string[]
}

export function DashboardManagementTable({ allGroups }: Props) {
  const currency = useCurrency()
  const symbol = getCurrencySymbol(currency)
  const [data, setData]       = useState<ManagementRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [filterStatus, setFilterStatus] = useState<string[]>([])
  const [filterStage,  setFilterStage]  = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/dashboard/management-data')
        if (res.ok) {
          const json = await res.json()
          if (!cancelled) setData(json.rows)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const availableStages = useMemo(() => {
    if (!data) return STAGE_ORDER
    const present = new Set(data.map(r => r.stage).filter(Boolean) as string[])
    return STAGE_ORDER.filter(s => present.has(s))
  }, [data])

  const toggleStatus = (v: string) =>
    setFilterStatus(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])
  const toggleStage = (v: string) =>
    setFilterStage(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])
  const clearFilters = () => { setFilterStatus([]); setFilterStage([]) }
  const hasFilters = filterStatus.length > 0 || filterStage.length > 0

  const handleSort = useCallback((key: string) => {
    setSortKey(prev => {
      if (prev !== key) { setSortDir('asc'); return key }
      setSortDir(d => d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc')
      return key
    })
  }, [])

  const grouped = useMemo((): [string | null, ManagementRow[]][] => {
    if (!data) return []
    const filtered = data.filter(row => {
      if (filterStatus.length > 0 && !filterStatus.includes(row.status)) return false
      if (filterStage.length > 0  && (row.stage == null || !filterStage.includes(row.stage))) return false
      return true
    })
    const map = new Map<string, ManagementRow[]>()
    const ungrouped: ManagementRow[] = []
    for (const row of filtered) {
      if (row.portfolioGroup.length === 0) { ungrouped.push(row) }
      else {
        for (const g of row.portfolioGroup) {
          const list = map.get(g) ?? []; list.push(row); map.set(g, list)
        }
      }
    }
    const result: [string | null, ManagementRow[]][] = []
    for (const g of allGroups)            if (map.has(g)) result.push([g, map.get(g)!])
    for (const [g, rows] of map.entries()) if (!allGroups.includes(g)) result.push([g, rows])
    if (ungrouped.length > 0) result.push([null, ungrouped])
    if (sortKey && sortDir) {
      const col = COLUMNS.find(c => c.key === sortKey)
      if (col) return result.map(([g, rows]) => {
        const sorted = [...rows].sort((a, b) => {
          const va = col.sortValue(a), vb = col.sortValue(b)
          if (va == null && vb == null) return 0
          if (va == null) return 1
          if (vb == null) return -1
          if (typeof va === 'string' && typeof vb === 'string')
            return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
          return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number)
        })
        return [g, sorted]
      })
    }
    return result
  }, [data, allGroups, sortKey, sortDir, filterStatus, filterStage])

  if (loading) return (
    <div className="rounded-lg border border-dashed p-12 text-center">
      <p className="text-muted-foreground text-sm">Loading management data…</p>
    </div>
  )
  if (!data || data.length === 0) return (
    <div className="rounded-lg border border-dashed p-12 text-center">
      <p className="text-muted-foreground">No data available.</p>
    </div>
  )

  const totalCols = COLUMNS.length
  const totalRows = grouped.reduce((acc, [, rows]) => acc + rows.length, 0)

  function SortIcon({ colKey }: { colKey: string }) {
    if (sortKey !== colKey || sortDir === null) return <ChevronsUpDown className="inline-block ml-1 h-3 w-3 opacity-30" />
    if (sortDir === 'asc')  return <ChevronUp   className="inline-block ml-1 h-3 w-3 opacity-80" />
    return <ChevronDown className="inline-block ml-1 h-3 w-3 opacity-80" />
  }

  // Pre-compute the starting col-index of each section header so we know
  // which section contains col 0 (Name) and whether we need to split it.
  // Section 0 = "Company" spans cols 0-2; col 0 is sticky, cols 1-2 are not.

  return (
    <div className="space-y-3">
      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground font-medium">Status:</span>
          <div className="flex gap-1">
            {STATUS_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => toggleStatus(opt.value)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                  filterStatus.includes(opt.value)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground font-medium">Stage:</span>
          <div className="flex flex-wrap gap-1">
            {availableStages.map(stage => {
              const c = STAGE_COLORS[stage] ?? { bg: '', text: '' }
              const active = filterStage.includes(stage)
              return (
                <button key={stage} onClick={() => toggleStage(stage)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                    active
                      ? `${c.bg} ${c.text} border-transparent`
                      : 'bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'
                  }`}>
                  {stage}
                </button>
              )
            })}
          </div>
        </div>
        {hasFilters && (
          <button onClick={clearFilters}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors ml-auto">
            <X className="h-3 w-3" />
            Clear filters
            <span className="ml-1 bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full text-[10px]">{totalRows}</span>
          </button>
        )}
      </div>

      {/* ── Table ── */}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full border-collapse text-xs whitespace-nowrap">
          <colgroup>
            {/* col 0: Name — auto width, sticky */}
            <col style={{ minWidth: '160px' }} />
            {/* cols 1+: equal fixed width */}
            {COLUMNS.slice(1).map(col => (
              <col key={col.key} style={{ width: '100px', minWidth: '100px' }} />
            ))}
          </colgroup>

          <thead>
            {/* ── Section header row ──
                "Company" section (colSpan 3, cols 0-2) is split into:
                  • col 0 – sticky cell with the "Company" label
                  • cols 1-2 – non-sticky empty continuation cell
                All other section headers render normally.
            */}
            <tr className="border-b border-primary/30">
              {/* Sticky Name cell carrying the "Company" label */}
              <th
                colSpan={1}
                className="px-3 py-1.5 text-[11px] font-semibold text-left bg-primary text-primary-foreground sticky left-0 z-20"
              >
                Company
              </th>
              {/* Rest of Company section (Stage + Status) — NOT sticky */}
              <th
                colSpan={SECTION_HEADERS[0].colSpan - 1}
                className="px-3 py-1.5 bg-primary text-primary-foreground border-r border-primary-foreground/20"
              />
              {/* Remaining section headers */}
              {SECTION_HEADERS.slice(1).map((s, i) => {
                const globalIdx = i + 1
                const isLast = SECTION_LAST_COL_INDICES.has(
                  SECTION_HEADERS.slice(0, globalIdx + 1).reduce((acc, h) => acc + h.colSpan, 0) - 1
                )
                return (
                  <th
                    key={globalIdx}
                    colSpan={s.colSpan}
                    className={`px-3 py-1.5 text-[11px] font-semibold text-left bg-primary text-primary-foreground ${
                      isLast ? 'border-r border-primary-foreground/20' : ''
                    } last:border-r-0`}
                  >
                    {s.label}
                  </th>
                )
              })}
            </tr>

            {/* ── Column header row ── */}
            <tr className="border-b border-border">
              {COLUMNS.map((col, i) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={[
                    'px-3 py-2 font-medium text-muted-foreground text-[11px] cursor-pointer select-none',
                    'hover:text-foreground transition-colors bg-card',
                    i === NAME_COL_IDX ? 'sticky left-0 z-20 text-left' : 'text-center',
                    SECTION_LAST_COL_INDICES.has(i) ? 'border-r border-border' : '',
                  ].join(' ')}
                >
                  {col.label}
                  <SortIcon colKey={col.key} />
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {totalRows === 0 ? (
              <tr>
                <td colSpan={totalCols} className="px-3 py-10 text-center text-muted-foreground text-xs">
                  No companies match the selected filters.
                </td>
              </tr>
            ) : grouped.map(([groupName, rows], groupIdx) => (
              <>
                {groupName !== null && (
                  <tr key={`group-${groupName}`}>
                    <td
                      colSpan={totalCols}
                      className={`px-3 py-2 text-xs font-semibold text-muted-foreground bg-muted/40 ${
                        groupIdx === 0 ? 'border-t border-border' : 'border-t-2 border-border'
                      }`}
                    >
                      {groupName}
                    </td>
                  </tr>
                )}
                {rows.map((row, rowIdx) => (
                  <tr
                    key={row.companyId}
                    className={`hover:bg-muted/30 transition-colors ${
                      rowIdx < rows.length - 1 ? 'border-b border-border/40' : ''
                    }`}
                  >
                    {COLUMNS.map((col, i) => (
                      <td
                        key={col.key}
                        className={[
                          'px-3 py-2',
                          i === NAME_COL_IDX
                            ? 'sticky left-0 z-10 bg-card text-left'
                            : 'text-center',
                          SECTION_LAST_COL_INDICES.has(i) ? 'border-r border-border/60' : '',
                        ].join(' ')}
                      >
                        {col.render(row, symbol)}
                      </td>
                    ))}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
