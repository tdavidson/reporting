'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Badge } from '@/components/ui/badge'
import { useCurrency, getCurrencySymbol } from '@/components/currency-context'

interface ManagementRow {
  companyId: string
  name: string
  logoUrl: string | null
  stage: string | null
  status: string
  portfolioGroup: string[]
  ownershipPct: number | null
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

// Stage colour scale
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

function fmt(value: number | null, type: 'currency' | 'pct' | 'multiple' | 'integer' | 'months', symbol: string): string {
  if (value == null) return '—'
  switch (type) {
    case 'currency': {
      const abs = Math.abs(value)
      const neg = value < 0 ? '-' : ''
      if (abs >= 1_000_000) return `${neg}${symbol}${(abs / 1_000_000).toFixed(1)}M`
      if (abs >= 1_000) return `${neg}${symbol}${(abs / 1_000).toFixed(0)}K`
      return `${neg}${symbol}${abs.toFixed(0)}`
    }
    case 'pct':
      return `${(value * 100).toFixed(1)}%`
    case 'multiple':
      return `${value.toFixed(2)}x`
    case 'integer':
      return value.toFixed(0)
    case 'months':
      return `${value}mo`
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function CompanyAvatar({ row }: { row: ManagementRow }) {
  const initials = row.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  return (
    <div className="w-7 h-7 rounded-md overflow-hidden bg-muted flex items-center justify-center flex-shrink-0">
      {row.logoUrl ? (
        <Image src={row.logoUrl} alt={row.name} width={28} height={28} className="object-cover w-full h-full" />
      ) : (
        <span className="text-[10px] font-semibold text-muted-foreground">{initials}</span>
      )}
    </div>
  )
}

interface SectionHeader {
  label: string
  colSpan: number
}

interface ColDef {
  key: string
  label: string
  align: 'left' | 'right' | 'center'
  render: (row: ManagementRow, symbol: string) => React.ReactNode
}

const SECTION_HEADERS: SectionHeader[] = [
  { label: 'Company',    colSpan: 3 },
  { label: '💼 Investment', colSpan: 3 },
  { label: '📈 Valuation', colSpan: 3 },
  { label: '📊 Operations', colSpan: 5 },
  { label: '🗓 Activity',  colSpan: 1 },
]

const COLUMNS: ColDef[] = [
  // Company (3)
  {
    key: 'name', label: 'Name', align: 'left',
    render: (row) => (
      <Link href={`/companies/${row.companyId}`} className="flex items-center gap-2 hover:underline font-medium">
        <CompanyAvatar row={row} />
        <span className="truncate max-w-[120px]">{row.name}</span>
      </Link>
    ),
  },
  {
    key: 'stage', label: 'Stage', align: 'center',
    render: (row) => stageBadge(row.stage),
  },
  {
    key: 'status', label: 'Status', align: 'center',
    render: (row) => statusBadge(row.status),
  },
  // Investment (3)
  {
    key: 'ownershipPct', label: 'Ownership %', align: 'right',
    render: (row, sym) => <span className="tabular-nums">{fmt(row.ownershipPct != null ? row.ownershipPct / 100 : null, 'pct', sym)}</span>,
  },
  {
    key: 'capitalInvested', label: 'Invested', align: 'right',
    render: (row, sym) => <span className="tabular-nums">{fmt(row.capitalInvested, 'currency', sym)}</span>,
  },
  {
    key: 'entryValuation', label: 'Entry Val.', align: 'right',
    render: (row, sym) => <span className="tabular-nums">{fmt(row.entryValuation, 'currency', sym)}</span>,
  },
  // Valuation (3)
  {
    key: 'currentValuation', label: 'Current Val.', align: 'right',
    render: (row, sym) => <span className="tabular-nums">{fmt(row.currentValuation, 'currency', sym)}</span>,
  },
  {
    key: 'moic', label: 'MOIC', align: 'right',
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
    key: 'evRevenue', label: 'EV/Rev', align: 'right',
    render: (row, sym) => <span className="tabular-nums">{fmt(row.evRevenue, 'multiple', sym)}</span>,
  },
  // Operations (5)
  {
    key: 'mrr', label: 'MRR', align: 'right',
    render: (row, sym) => <span className="tabular-nums">{fmt(row.mrr, 'currency', sym)}</span>,
  },
  {
    key: 'mrrGrowth', label: 'MRR MoM', align: 'right',
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
    key: 'cash', label: 'Cash', align: 'right',
    render: (row, sym) => <span className="tabular-nums">{fmt(row.cash, 'currency', sym)}</span>,
  },
  {
    key: 'burn', label: 'Burn/mo', align: 'right',
    render: (row, sym) => <span className="tabular-nums">{fmt(row.burn, 'currency', sym)}</span>,
  },
  {
    key: 'runway', label: 'Runway', align: 'right',
    render: (row, sym) => {
      if (row.runway == null) return <span className="text-muted-foreground/40">—</span>
      const color = row.runway <= 3 ? 'text-red-500 dark:text-red-400' :
                    row.runway <= 6 ? 'text-amber-500 dark:text-amber-400' :
                    'text-green-600 dark:text-green-400'
      return <span className={`tabular-nums font-medium ${color}`}>{row.runway}mo</span>
    },
  },
  // Activity (1)
  {
    key: 'lastUpdateAt', label: 'Last Update', align: 'left',
    render: (row) => <span className="text-muted-foreground text-xs">{fmtDate(row.lastUpdateAt)}</span>,
  },
]

interface Props {
  allGroups: string[]
}

export function DashboardManagementTable({ allGroups }: Props) {
  const currency = useCurrency()
  const symbol = getCurrencySymbol(currency)
  const [data, setData] = useState<ManagementRow[] | null>(null)
  const [loading, setLoading] = useState(true)

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

  // Group rows by portfolioGroup
  const grouped = useMemo((): [string, ManagementRow[]][] => {
    if (!data) return []
    const map = new Map<string, ManagementRow[]>()
    for (const row of data) {
      const groups = row.portfolioGroup.length > 0 ? row.portfolioGroup : ['(no group)']
      for (const g of groups) {
        const list = map.get(g) ?? []
        list.push(row)
        map.set(g, list)
      }
    }
    // Order: allGroups order first, then others
    const result: [string, ManagementRow[]][] = []
    for (const g of allGroups) {
      if (map.has(g)) result.push([g, map.get(g)!])
    }
    for (const [g, rows] of Array.from(map.entries())) {
      if (!allGroups.includes(g)) result.push([g, rows])
    }
    return result
  }, [data, allGroups])

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

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full border-collapse text-xs whitespace-nowrap">
        <thead>
          {/* Section header row */}
          <tr className="border-b border-border">
            {SECTION_HEADERS.map((s, i) => (
              <th
                key={i}
                colSpan={s.colSpan}
                className={`px-3 py-1.5 text-[11px] font-semibold text-muted-foreground text-left border-r border-border/50 last:border-r-0 ${
                  i === 0 ? 'sticky left-0 z-20 bg-card' : 'bg-muted/30'
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
                className={`px-3 py-2 font-medium text-muted-foreground text-[11px] ${
                  col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                } ${
                  i === 0 ? 'sticky left-0 z-20 bg-card' : 'bg-card'
                }`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grouped.map(([groupName, rows]) => (
            <>
              {/* Group header */}
              <tr key={`group-${groupName}`}>
                <td
                  colSpan={totalCols}
                  className="px-3 py-2 text-xs font-semibold text-muted-foreground bg-muted/40 border-t border-border"
                >
                  {groupName}
                </td>
              </tr>
              {/* Company rows */}
              {rows.map(row => (
                <tr key={row.companyId} className="border-t border-border/50 hover:bg-muted/30 transition-colors">
                  {COLUMNS.map((col, i) => (
                    <td
                      key={col.key}
                      className={`px-3 py-2 ${
                        col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                      } ${
                        i === 0 ? 'sticky left-0 z-10 bg-card hover:bg-muted/30' : ''
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
