'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Badge } from '@/components/ui/badge'
import { useCurrency, getCurrencySymbol } from '@/components/currency-context'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

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

const STAGE_COLORS: Record<string, { bg: string; text: string }> = {
  'Pre-Seed': { bg: 'bg-sky-100 dark:bg-sky-950', text: 'text-sky-700 dark:text-sky-400' },
  'Seed':     { bg: 'bg-sky-200 dark:bg-sky-900', text: 'text-sky-700 dark:text-sky-300' },
  'Series A': { bg: 'bg-blue-200 dark:bg-blue-900', text: 'text-blue-700 dark:text-blue-300' },
  'Series B': { bg: 'bg-blue-300 dark:bg-blue-800', text: 'text-blue-800 dark:text-blue-200' },
  'Series C': { bg: 'bg-indigo-300 dark:bg-indigo-800', text: 'text-indigo-800 dark:text-indigo-200' },
  'Growth':   { bg: 'bg-indigo-400 dark:bg-indigo-700', text: 'text-indigo-900 dark:text-indigo-100' },
  'IPO track':{ bg: 'bg-violet-500 dark:bg-violet-600', text: 'text-white' },
}

function stageBadge(stage: string | null) {
  if (!stage) return <span className="text-muted-foreground/40 text-xs">—</span>
  const c = STAGE_COLORS[stage] ?? { bg: 'bg-blue-100 dark:bg-blue-900', text: 'text-blue-700 dark:text-blue-300' }
  return (
    <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${c.bg} ${c.text}`}>
      {stage}
    </Badge>
  )
}

function statusBadge(status: string) {
  if (status === 'exited') return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">Exited</Badge>
  if (status === 'written-off') return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">Written Off</Badge>
  return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">Active</Badge>
}

function withThousands(n: number): string {
  return n.toLocaleString('en-US')
}

function fmt(value: number | null, type: 'currency' | 'pct' | 'multiple' | 'integer' | 'months', symbol: string): string {
  if (value == null) return '—'
  switch (type) {
    case 'currency': {
      const abs = Math.abs(value)
      const neg = value < 0 ? '-' : ''
      if (abs >= 1_000_000) return `${neg}${symbol}${(abs / 1_000_000).toFixed(1)}M`
      if (abs >= 1_000) return `${neg}${symbol}${withThousands(Math.round(abs / 1_000) * 1_000).replace(/,/g, ',')}K`.replace('K', () => {
        // e.g. $500K — keep abbreviated but with comma if needed in the number part
        const k = abs / 1_000
        return `${k % 1 === 0 ? withThousands(Math.round(k)) : k.toFixed(1)}K`
      }).replace(`${neg}${symbol}`, `${neg}${symbol}`)
      return `${neg}${symbol}${withThousands(Math.round(abs))}`
    }
    case 'pct':
      return `${(value * 100).toFixed(1)}%`
    case 'multiple':
      return `${value.toFixed(2)}x`
    case 'integer':
      return withThousands(Math.round(value))
    case 'months':
      return `${value}mo`
  }
}

// Cleaner currency fmt helper used internally
function fmtCurrency(value: number | null, symbol: string): string {
  if (value == null) return '—'
  const abs = Math.abs(value)
  const neg = value < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${neg}${symbol}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) {
    const k = abs / 1_000
    const kStr = k % 1 === 0 ? withThousands(Math.round(k)) : k.toFixed(1)
    return `${neg}${symbol}${kStr}K`
  }
  return `${neg}${symbol}${withThousands(Math.round(abs))}`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Section layout:
// Company    → cols 0,1,2       (colSpan 3, last=2)
// Investment → cols 3,4,5      (colSpan 3, last=5)  Entry Own%, Current Own%, Invested
// Valuation  → cols 6,7,8,9   (colSpan 4, last=9)  Entry Val., Current Val., MOIC, EV/Rev(ARR)
// Operations → cols 10,11,12,13,14 (colSpan 5, last=14) MRR, MRR MoM, Cash, Burn, Runway
// Activity   → col 15          (colSpan 1)
const SECTION_LAST_COL_INDICES = new Set([2, 5, 9, 14])

interface SectionHeader {
  label: string
  colSpan: number
}

interface ColDef {
  key: string
  label: string
  align: 'left' | 'right' | 'center'
  sortValue: (row: ManagementRow) => number | string | null
  render: (row: ManagementRow, symbol: string) => React.ReactNode
}

const SECTION_HEADERS: SectionHeader[] = [
  { label: 'Company',      colSpan: 3 },
  { label: '💼 Investment', colSpan: 3 },
  { label: '📈 Valuation',  colSpan: 4 },
  { label: '📊 Operations', colSpan: 5 },
  { label: '🗓 Activity',   colSpan: 1 },
]

const COLUMNS: ColDef[] = [
  // ── Company (0-2) ──
  {
    key: 'name', label: 'Name', align: 'left',
    sortValue: (row) => row.name,
    render: (row) => (
      <Link href={`/companies/${row.companyId}`} className="flex items-center gap-2 hover:underline font-medium">
        <span className="truncate max-w-[140px]">{row.name}</span>
      </Link>
    ),
  },
  {
    key: 'stage', label: 'Stage', align: 'center',
    sortValue: (row) => row.stage ?? '',
    render: (row) => stageBadge(row.stage),
  },
  {
    key: 'status', label: 'Status', align: 'center',
    sortValue: (row) => row.status,
    render: (row) => statusBadge(row.status),
  },
  // ── Investment (3-5) ──
  {
    key: 'entryOwnershipPct', label: 'Entry Own.%', align: 'center',
    sortValue: (row) => row.entryOwnershipPct,
    render: (row, sym) => <span className="tabular-nums">{fmt(row.entryOwnershipPct != null ? row.entryOwnershipPct / 100 : null, 'pct', sym)}</span>,
  },
  {
    key: 'ownershipPct', label: 'Current Own.%', align: 'center',
    sortValue: (row) => row.ownershipPct,
    render: (row, sym) => <span className="tabular-nums">{fmt(row.ownershipPct != null ? row.ownershipPct / 100 : null, 'pct', sym)}</span>,
  },
  {
    key: 'capitalInvested', label: 'Invested', align: 'center',
    sortValue: (row) => row.capitalInvested,
    render: (row, sym) => <span className="tabular-nums">{fmtCurrency(row.capitalInvested, sym)}</span>,
  },
  // ── Valuation (6-9) ──
  {
    key: 'entryValuation', label: 'Entry Val.', align: 'center',
    sortValue: (row) => row.entryValuation,
    render: (row, sym) => <span className="tabular-nums">{fmtCurrency(row.entryValuation, sym)}</span>,
  },
  {
    key: 'currentValuation', label: 'Current Val.', align: 'center',
    sortValue: (row) => row.currentValuation,
    render: (row, sym) => <span className="tabular-nums">{fmtCurrency(row.currentValuation, sym)}</span>,
  },
  {
    key: 'moic', label: 'MOIC', align: 'center',
    sortValue: (row) => row.moic,
    render: (row, sym) => (
      <span className={`tabular-nums font-medium ${
        row.moic != null && row.moic >= 2 ? 'text-green-600 dark:text-green-400' :
        row.moic != null && row.moic < 1  ? 'text-red-500 dark:text-red-400' : ''
      }`}>
        {fmt(row.moic, 'multiple', sym)}
      </span>
    ),
  },
  {
    key: 'evRevenue', label: 'EV/Rev (ARR)', align: 'center',
    sortValue: (row) => row.evRevenue,
    render: (row, sym) => <span className="tabular-nums">{fmt(row.evRevenue, 'multiple', sym)}</span>,
  },
  // ── Operations (10-14) ──
  {
    key: 'mrr', label: 'MRR', align: 'center',
    sortValue: (row) => row.mrr,
    render: (row, sym) => <span className="tabular-nums">{fmtCurrency(row.mrr, sym)}</span>,
  },
  {
    key: 'mrrGrowth', label: 'MRR MoM', align: 'center',
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
    key: 'cash', label: 'Cash', align: 'center',
    sortValue: (row) => row.cash,
    render: (row, sym) => <span className="tabular-nums">{fmtCurrency(row.cash, sym)}</span>,
  },
  {
    key: 'burn', label: 'Burn/mo', align: 'center',
    sortValue: (row) => row.burn,
    render: (row, sym) => <span className="tabular-nums">{fmtCurrency(row.burn, sym)}</span>,
  },
  {
    key: 'runway', label: 'Runway', align: 'center',
    sortValue: (row) => row.runway,
    render: (row) => {
      if (row.runway == null) return <span className="text-muted-foreground/40">—</span>
      const color = row.runway <= 3 ? 'text-red-500 dark:text-red-400' :
                    row.runway <= 6 ? 'text-amber-500 dark:text-amber-400' :
                    'text-green-600 dark:text-green-400'
      return <span className={`tabular-nums font-medium ${color}`}>{row.runway}mo</span>
    },
  },
  // ── Activity (15) ──
  {
    key: 'lastUpdateAt', label: 'Last Update', align: 'center',
    sortValue: (row) => row.lastUpdateAt ?? '',
    render: (row) => <span className="text-muted-foreground text-xs">{fmtDate(row.lastUpdateAt)}</span>,
  },
]

type SortDir = 'asc' | 'desc' | null

interface Props {
  allGroups: string[]
}

export function DashboardManagementTable({ allGroups }: Props) {
  const currency = useCurrency()
  const symbol = getCurrencySymbol(currency)
  const [data, setData] = useState<ManagementRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)

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

  const handleSort = useCallback((key: string) => {
    setSortKey(prev => {
      if (prev !== key) { setSortDir('asc'); return key }
      setSortDir(d => d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc')
      return key
    })
  }, [])

  const grouped = useMemo((): [string | null, ManagementRow[]][] => {
    if (!data) return []
    const map = new Map<string, ManagementRow[]>()
    const ungrouped: ManagementRow[] = []

    for (const row of data) {
      if (row.portfolioGroup.length === 0) {
        ungrouped.push(row)
      } else {
        for (const g of row.portfolioGroup) {
          const list = map.get(g) ?? []
          list.push(row)
          map.set(g, list)
        }
      }
    }

    const result: [string | null, ManagementRow[]][] = []

    for (const g of allGroups) {
      if (map.has(g)) result.push([g, map.get(g)!])
    }
    for (const [g, rows] of Array.from(map.entries())) {
      if (!allGroups.includes(g)) result.push([g, rows])
    }
    if (ungrouped.length > 0) result.push([null, ungrouped])

    if (sortKey && sortDir) {
      const col = COLUMNS.find(c => c.key === sortKey)
      if (col) {
        return result.map(([g, rows]) => {
          const sorted = [...rows].sort((a, b) => {
            const va = col.sortValue(a)
            const vb = col.sortValue(b)
            if (va == null && vb == null) return 0
            if (va == null) return 1
            if (vb == null) return -1
            if (typeof va === 'string' && typeof vb === 'string') {
              return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
            }
            return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number)
          })
          return [g, sorted]
        })
      }
    }
    return result
  }, [data, allGroups, sortKey, sortDir])

  if (loading) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <p className="text-muted-foreground text-sm">Loading management data…</p>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <p className="text-muted-foreground">No data available.</p>
      </div>
    )
  }

  const totalCols = COLUMNS.length

  function SortIcon({ colKey }: { colKey: string }) {
    if (sortKey !== colKey || sortDir === null) return <ChevronsUpDown className="inline-block ml-1 h-3 w-3 opacity-30" />
    if (sortDir === 'asc') return <ChevronUp className="inline-block ml-1 h-3 w-3 opacity-80" />
    return <ChevronDown className="inline-block ml-1 h-3 w-3 opacity-80" />
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full border-collapse text-xs whitespace-nowrap">
        <colgroup>
          {/* Name column: auto width */}
          <col className="w-auto min-w-[160px]" />
          {/* All other columns: equal fixed width */}
          {COLUMNS.slice(1).map((col) => (
            <col key={col.key} style={{ width: '100px', minWidth: '100px' }} />
          ))}
        </colgroup>
        <thead>
          {/* Section header row — graphite background */}
          <tr className="border-b border-border bg-zinc-700 dark:bg-zinc-800">
            {SECTION_HEADERS.map((s, i) => (
              <th
                key={i}
                colSpan={s.colSpan}
                className={`px-3 py-1.5 text-[11px] font-semibold text-zinc-100 text-left ${
                  SECTION_LAST_COL_INDICES.has(
                    SECTION_HEADERS.slice(0, i + 1).reduce((acc, h) => acc + h.colSpan, 0) - 1
                  ) ? 'border-r border-zinc-600' : ''
                } last:border-r-0 ${
                  i === 0 ? 'sticky left-0 z-20 bg-zinc-700 dark:bg-zinc-800' : ''
                }`}
              >
                {s.label}
              </th>
            ))}
          </tr>
          {/* Column header row */}
          <tr className="border-b border-border">
            {COLUMNS.map((col, i) => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                className={`px-3 py-2 font-medium text-muted-foreground text-[11px] cursor-pointer select-none hover:text-foreground transition-colors text-center ${
                  i === 0 ? 'sticky left-0 z-20 bg-card text-left' : 'bg-card'
                } ${
                  SECTION_LAST_COL_INDICES.has(i) ? 'border-r border-border' : ''
                }`}
              >
                {col.label}
                <SortIcon colKey={col.key} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grouped.map(([groupName, rows], groupIdx) => (
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
                      className={`px-3 py-2 text-center ${
                        i === 0 ? 'sticky left-0 z-10 bg-card hover:bg-muted/30 text-left' : ''
                      } ${
                        SECTION_LAST_COL_INDICES.has(i) ? 'border-r border-border/60' : ''
                      }`}
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
  )
}
