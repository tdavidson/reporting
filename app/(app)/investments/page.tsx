'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, ChevronUp, ChevronDown, Lock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { useCurrency, formatCurrencyFull } from '@/components/currency-context'
import { useDisplayUnit } from '@/components/display-unit-context'
import type { CompanyStatus } from '@/lib/types/database'
import { xirr, type CashFlow } from '@/lib/xirr'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'
import { PortfolioNotesProvider, PortfolioNotesButton, PortfolioNotesPanel } from '@/components/portfolio-notes'
import { useFeatureVisibility } from '@/components/feature-visibility-context'
import { DisplayPanelButton } from '@/components/display-panel'

interface CompanySummary {
  companyId: string
  companyName: string
  status: CompanyStatus
  portfolioGroup: string[]
  totalInvested: number
  totalRealized: number
  unrealizedValue: number
  fmv: number
  moic: number | null
  irr: number | null
  proceedsReceived: number
  totalCostBasisExited: number
}

interface GroupSummary {
  group: string
  totalInvested: number
  proceedsReceived: number
  totalRealized: number
  unrealizedValue: number
  totalCostBasisExited: number
  moic: number | null
  irr: number | null
}

interface FundCashFlow {
  id: string
  portfolio_group: string
  flow_date: string
  flow_type: 'commitment' | 'called_capital' | 'distribution'
  amount: number
}

interface FundGroupMetrics {
  tvpi: number | null
  dpi: number | null
  rvpi: number | null
  netIrr: number | null
}

function computeFundMetricsByGroup(
  cashFlows: FundCashFlow[],
  grossResidualByGroup: Map<string, number>,
  configsByGroup: Record<string, { cashOnHand: number; carryRate: number; gpCommitPct: number }>
): Map<string, FundGroupMetrics> {
  const byGroup = new Map<string, FundCashFlow[]>()
  for (const cf of cashFlows) {
    const list = byGroup.get(cf.portfolio_group) ?? []
    list.push(cf)
    byGroup.set(cf.portfolio_group, list)
  }

  const result = new Map<string, FundGroupMetrics>()
  for (const [group, flows] of Array.from(byGroup.entries())) {
    let called = 0
    let distributions = 0
    for (const cf of flows) {
      if (cf.flow_type === 'called_capital') called += cf.amount
      if (cf.flow_type === 'distribution') distributions += cf.amount
    }

    const grossResidual = grossResidualByGroup.get(group) ?? 0
    const config = configsByGroup[group] ?? { cashOnHand: 0, carryRate: 0.20, gpCommitPct: 0 }
    const grossAssets = grossResidual + config.cashOnHand

    const gpCapital = called * config.gpCommitPct
    const lpCapital = called - gpCapital
    const lpDistributions = distributions * (1 - config.gpCommitPct)
    const lpRemainingCapital = lpCapital - lpDistributions
    const estimatedCarry = Math.max(0, config.carryRate * (grossAssets * (1 - config.gpCommitPct) - lpRemainingCapital))
    const netResidual = grossAssets - estimatedCarry
    const totalValue = distributions + netResidual

    const tvpi = called > 0 ? totalValue / called : null
    const dpi = called > 0 ? distributions / called : null
    const rvpi = called > 0 ? netResidual / called : null

    const xirrFlows: CashFlow[] = []
    for (const cf of flows) {
      if (cf.flow_type === 'called_capital') xirrFlows.push({ date: new Date(cf.flow_date), amount: -cf.amount })
      if (cf.flow_type === 'distribution') xirrFlows.push({ date: new Date(cf.flow_date), amount: cf.amount })
    }
    if (netResidual > 0) xirrFlows.push({ date: new Date(), amount: netResidual })
    const netIrr = xirrFlows.length >= 2 ? xirr(xirrFlows) : null

    result.set(group, { tvpi, dpi, rvpi, netIrr })
  }
  return result
}

interface PortfolioData {
  totalInvested: number
  totalRealized: number
  totalUnrealized: number
  totalFMV: number
  portfolioMOIC: number | null
  portfolioIRR: number | null
  companies: CompanySummary[]
  groups: GroupSummary[]
}

type SortKey = 'companyName' | 'status' | 'portfolioGroup' | 'totalInvested' | 'proceedsReceived' | 'unrealizedValue' | 'totalValue' | 'moic' | 'irr' | 'pctTotalValue'
type SortDir = 'asc' | 'desc'

type GroupSortKey = 'group' | 'totalInvested' | 'proceedsReceived' | 'unrealizedValue' | 'totalValue' | 'moic' | 'irr'

function totalValue(row: { totalRealized: number; unrealizedValue: number }) {
  return row.totalRealized + row.unrealizedValue
}

function fmtMoic(val: number | null): string {
  if (val == null) return '-'
  return `${val.toFixed(2)}x`
}

function fmtIrr(val: number | null): string {
  if (val == null) return '-'
  let pct = val * 100
  if (Object.is(pct, -0) || (pct < 0 && pct > -0.05)) pct = 0
  return `${pct.toFixed(1)}%`
}

const STATUS_COLORS: Record<CompanyStatus, string> = {
  active: 'text-green-600',
  exited: 'text-blue-600',
  'written-off': 'text-muted-foreground',
}

const TEXT_SORT_KEYS: SortKey[] = ['companyName', 'status', 'portfolioGroup']

function getDerivedValue(row: CompanySummary, key: SortKey, helpers?: { pctTotalValue: (c: CompanySummary) => number | null }): number {
  switch (key) {
    case 'proceedsReceived': return row.proceedsReceived
    case 'unrealizedValue': return row.unrealizedValue
    case 'totalValue': return totalValue(row)
    case 'totalInvested': return row.totalInvested
    case 'moic': return row.moic ?? -Infinity
    case 'irr': return row.irr ?? -Infinity
    case 'pctTotalValue': return helpers?.pctTotalValue(row) ?? -Infinity
    default: return 0
  }
}

function getGroupDerivedValue(row: GroupSummary, key: GroupSortKey): number {
  switch (key) {
    case 'proceedsReceived': return row.proceedsReceived
    case 'unrealizedValue': return row.unrealizedValue
    case 'totalValue': return totalValue(row)
    case 'totalInvested': return row.totalInvested
    case 'moic': return row.moic ?? -Infinity
    case 'irr': return row.irr ?? -Infinity
    default: return 0
  }
}

export default function InvestmentsPage() {
  const fv = useFeatureVisibility()
const currency = useCurrency()
const { displayUnit } = useDisplayUnit()
const symbol = currency === 'BRL' ? 'R$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$'
const fmtFull = (val: number) => formatCurrencyFull(val, currency)
const fmtCard = (val: number) => `${symbol}${(val / 1_000_000).toFixed(1)}M`
const fmtTable = (val: number) => {
  if (displayUnit === 'millions') return `${symbol}${(val / 1_000_000).toFixed(1)}M`
  if (displayUnit === 'thousands') return `${symbol}${(val / 1_000).toLocaleString('en-US', { maximumFractionDigits: 0 })}K`
  return formatCurrencyFull(val, currency)
}
const fmt = fmtCard

  const [data, setData] = useState<PortfolioData | null>(null)
  const [loading, setLoading] = useState(true)
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().split('T')[0])

  const [sortKey, setSortKey] = useState<SortKey>('totalValue')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [statusFilter, setStatusFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')

  const [groupSortKey, setGroupSortKey] = useState<GroupSortKey>('totalInvested')
  const [groupSortDir, setGroupSortDir] = useState<SortDir>('desc')

  const [fundCashFlows, setFundCashFlows] = useState<FundCashFlow[]>([])
  const [groupConfigs, setGroupConfigs] = useState<Record<string, { cashOnHand: number; carryRate: number; gpCommitPct: number; vintage: number | null }>>({})

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [invRes, cfRes, gcRes] = await Promise.all([
          fetch(`/api/portfolio/investments?asOf=${asOfDate}`),
          fetch('/api/portfolio/fund-cash-flows'),
          fetch('/api/portfolio/fund-group-config'),
        ])
        if (invRes.ok) setData(await invRes.json())
        if (cfRes.ok) setFundCashFlows(await cfRes.json())
        if (gcRes.ok) {
          const configs = await gcRes.json()
          const map: Record<string, { cashOnHand: number; carryRate: number; gpCommitPct: number; vintage: number | null }> = {}
          for (const c of configs) {
            map[c.portfolio_group] = {
              cashOnHand: Number(c.cash_on_hand) || 0,
              carryRate: c.carry_rate != null ? Number(c.carry_rate) : 0.20,
              gpCommitPct: Number(c.gp_commit_pct) || 0,
              vintage: c.vintage != null ? Number(c.vintage) : null,
            }
          }
          setGroupConfigs(map)
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [asOfDate])

  const availableGroups = useMemo(() => {
    if (!data) return []
    const groups = new Set<string>()
    for (const c of data.companies) {
      for (const g of c.portfolioGroup) groups.add(g)
    }
    return Array.from(groups).sort()
  }, [data])

const availableCompanies = useMemo(() => {
  if (!data) return []
  const seen = new Set<string>()
  return [...data.companies]
    .sort((a, b) => a.companyName.localeCompare(b.companyName))
    .filter(c => {
      if (seen.has(c.companyName)) return false
      seen.add(c.companyName)
      return true
    })
    .map(c => ({ id: c.companyId, name: c.companyName }))
}, [data])

  const fundMetricsByGroup = useMemo(() => {
    if (!data) return new Map<string, FundGroupMetrics>()
    const grossResidualByGroup = new Map<string, number>()
    for (const g of data.groups ?? []) {
      grossResidualByGroup.set(g.group, g.unrealizedValue)
    }
    return computeFundMetricsByGroup(fundCashFlows, grossResidualByGroup, groupConfigs)
  }, [fundCashFlows, data, groupConfigs])

  const groupTotalsMap = useMemo(() => {
    const map = new Map<string, { totalVal: number }>()
    if (!data) return map
    for (const g of data.groups ?? []) {
      map.set(g.group, { totalVal: totalValue(g) })
    }
    return map
  }, [data])

  function pctOfGroupTotalValue(c: CompanySummary): number | null {
    const groupName = c.portfolioGroup[0] ?? ''
    const gt = groupTotalsMap.get(groupName)
    if (!gt || gt.totalVal === 0) return null
    return totalValue(c) / gt.totalVal
  }

  const filtered = useMemo(() => {
    if (!data) return []
    let list = data.companies
    if (statusFilter) list = list.filter(c => c.status === statusFilter)
    if (groupFilter) list = list.filter(c => c.portfolioGroup.includes(groupFilter))
    if (companyFilter) list = list.filter(c => c.companyId === companyFilter)
    const dir = sortDir === 'asc' ? 1 : -1
    list = [...list].sort((a, b) => {
      if (sortKey === 'companyName') return dir * a.companyName.localeCompare(b.companyName)
      if (sortKey === 'status') return dir * a.status.localeCompare(b.status)
      if (sortKey === 'portfolioGroup') return dir * (a.portfolioGroup.join(', ')).localeCompare(b.portfolioGroup.join(', '))
      const helpers = { pctTotalValue: pctOfGroupTotalValue }
      const av = getDerivedValue(a, sortKey, helpers)
      const bv = getDerivedValue(b, sortKey, helpers)
      return dir * (av - bv)
    })
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, statusFilter, groupFilter, companyFilter, sortKey, sortDir, groupTotalsMap])

  const sortedGroups = useMemo(() => {
    if (!data || !data.groups || data.groups.length === 0) return []
    const dir = groupSortDir === 'asc' ? 1 : -1
    return [...data.groups].sort((a, b) => {
      if (groupSortKey === 'group') return dir * a.group.localeCompare(b.group)
      const av = getGroupDerivedValue(a, groupSortKey)
      const bv = getGroupDerivedValue(b, groupSortKey)
      return dir * (av - bv)
    })
  }, [data, groupSortKey, groupSortDir, groupConfigs])

  const groupTotals = useMemo(() => {
    if (sortedGroups.length === 0) return null
    const t = { totalInvested: 0, proceedsReceived: 0, totalRealized: 0, unrealizedValue: 0, totalCostBasisExited: 0 }
    for (const g of sortedGroups) {
      t.totalInvested += g.totalInvested
      t.proceedsReceived += g.proceedsReceived
      t.totalRealized += g.totalRealized
      t.unrealizedValue += g.unrealizedValue
      t.totalCostBasisExited += g.totalCostBasisExited
    }
    const moic = t.totalInvested > 0 ? (t.totalRealized + t.unrealizedValue) / t.totalInvested : null
    return { ...t, moic }
  }, [sortedGroups])

  const totals = useMemo(() => {
    const t = { totalInvested: 0, totalRealized: 0, unrealizedValue: 0, proceedsReceived: 0, totalCostBasisExited: 0 }
    for (const c of filtered) {
      t.totalInvested += c.totalInvested
      t.totalRealized += c.totalRealized
      t.unrealizedValue += c.unrealizedValue
      t.proceedsReceived += c.proceedsReceived
      t.totalCostBasisExited += c.totalCostBasisExited
    }
    const moic = t.totalInvested > 0 ? (t.totalRealized + t.unrealizedValue) / t.totalInvested : null
    return { ...t, moic }
  }, [filtered])

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(TEXT_SORT_KEYS.includes(key) ? 'asc' : 'desc')
    }
  }

  function handleGroupSort(key: GroupSortKey) {
    if (groupSortKey === key) {
      setGroupSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setGroupSortKey(key)
      setGroupSortDir(key === 'group' ? 'asc' : 'desc')
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return null
    return sortDir === 'asc'
      ? <ChevronUp className="inline h-3 w-3 ml-0.5" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5" />
  }

  function GroupSortIcon({ col }: { col: GroupSortKey }) {
    if (groupSortKey !== col) return null
    return groupSortDir === 'asc'
      ? <ChevronUp className="inline h-3 w-3 ml-0.5" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5" />
  }

  const groupNumericColumns: { label: string; sortKey: GroupSortKey; getValue: (row: GroupSummary) => number | null; format: 'currency' | 'moic' | 'irr' }[] = [
    { label: 'Invested', sortKey: 'totalInvested', getValue: r => r.totalInvested, format: 'currency' },
    { label: 'Proceeds', sortKey: 'proceedsReceived', getValue: r => r.proceedsReceived, format: 'currency' },
    { label: 'Current NAV', sortKey: 'unrealizedValue', getValue: r => r.unrealizedValue, format: 'currency' },
    { label: 'Total Value', sortKey: 'totalValue', getValue: r => totalValue(r), format: 'currency' },
    { label: 'Gross IRR', sortKey: 'irr', getValue: r => r.irr ?? null, format: 'irr' },
  ]

  const companyNumericColumns: { label: string; sortKey: SortKey; getValue: (row: CompanySummary) => number | null; format: 'currency' | 'moic' | 'irr' }[] = [
    { label: 'Invested', sortKey: 'totalInvested', getValue: r => r.totalInvested, format: 'currency' },
    { label: 'Proceeds', sortKey: 'proceedsReceived', getValue: r => r.proceedsReceived, format: 'currency' },
    { label: 'Current NAV', sortKey: 'unrealizedValue', getValue: r => r.unrealizedValue, format: 'currency' },
    { label: 'Total Value', sortKey: 'totalValue', getValue: r => totalValue(r), format: 'currency' },
    { label: 'Gross MOIC', sortKey: 'moic', getValue: r => r.moic ?? null, format: 'moic' },
    { label: 'Gross IRR', sortKey: 'irr', getValue: r => r.irr ?? null, format: 'irr' },
  ]

function fmtVal(val: number | null, format: 'currency' | 'moic' | 'irr'): string {
  if (val == null || val === 0) return '-'
  if (format === 'moic') return fmtMoic(val)
  if (format === 'irr') return fmtIrr(val)
  return fmtTable(val)
}

  const heading = (
    <div className="mb-6 space-y-1">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">{fv.investments === 'admin' && <Lock className="h-4 w-4 text-amber-500" />}Investments</h1>
      <div className="flex items-center gap-2"><DisplayPanelButton /><PortfolioNotesButton /><AnalystToggleButton /></div>
      </div>
      <p className="text-sm text-muted-foreground">Portfolio-level investment positions and returns</p>
      <div className="flex items-center gap-2 pt-2">
        <span className="text-sm text-muted-foreground">As of</span>
        <input
          type="date"
          value={asOfDate}
          onChange={e => setAsOfDate(e.target.value)}
          className="border rounded px-2 py-1 text-sm"
        />
      </div>
    </div>
  )

  if (loading) {
    return (
      <PortfolioNotesProvider pageContext="investments">
      <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
        {heading}
        <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 w-full">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        </div>
        <PortfolioNotesPanel />
        <AnalystPanel />
        </div>
      </div>
      </PortfolioNotesProvider>
    )
  }

  if (!data || data.companies.length === 0) {
    return (
      <PortfolioNotesProvider pageContext="investments">
      <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
        {heading}
        <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 w-full">
          <p className="text-sm text-muted-foreground">
            No investment data yet. Add transactions from individual company pages or use the Import page.
          </p>
        </div>
        <PortfolioNotesPanel />
        <AnalystPanel />
        </div>
      </div>
      </PortfolioNotesProvider>
    )
  }

  return (
    <PortfolioNotesProvider pageContext="investments">
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
      {heading}

      <div className="flex flex-col lg:flex-row gap-6 items-start">
      <div className="flex-1 min-w-0 w-full">

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground mb-1">Total Invested</p>
            <p className="text-xl font-semibold">{fmt(data.totalInvested)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground mb-1">Current NAV</p>
            <p className="text-xl font-semibold">{fmt(data.totalFMV)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground mb-1">Total Realized</p>
            <p className="text-xl font-semibold">{fmt(data.totalRealized)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground mb-1">Gross MOIC</p>
            <p className="text-xl font-semibold">{fmtMoic(data.portfolioMOIC)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground mb-1">Gross IRR</p>
            <p className="text-xl font-semibold">{fmtIrr(data.portfolioIRR)}</p>
          </CardContent>
        </Card>
      </div>

      {sortedGroups.length > 0 && groupTotals && (
        <div className="mb-8">
          <h2 className="text-sm font-medium text-muted-foreground mb-2">Portfolio Groups</h2>
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b bg-muted">
                  <th className="text-left px-3 py-2 font-medium sticky left-0 bg-muted z-10">
                    <button onClick={() => handleGroupSort('group')} className="hover:text-foreground">
                      Group<GroupSortIcon col="group" />
                    </button>
                  </th>
                  {groupNumericColumns.map(col => (
                    <th key={col.sortKey} className="text-right px-3 py-2 font-medium">
                      <button onClick={() => handleGroupSort(col.sortKey)} className="hover:text-foreground">
                        {col.label}<GroupSortIcon col={col.sortKey} />
                      </button>
                    </th>
                  ))}
                  <th className="text-right px-3 py-2 font-medium">Net IRR</th>
                  <th className="text-right px-3 py-2 font-medium">Gross MOIC</th>
                  <th className="text-right px-3 py-2 font-medium">TVPI</th>
                  <th className="text-right px-3 py-2 font-medium">DPI</th>
                  <th className="text-right px-3 py-2 font-medium">RVPI</th>
                </tr>
              </thead>
              <tbody>
                {sortedGroups.length > 1 && (
                  <tr className="border-b bg-blue-50 dark:bg-blue-950 font-medium">
                    <td className="px-3 py-2 sticky left-0 bg-blue-50 dark:bg-blue-950 z-10">Prlx Fund I</td>
                    {groupNumericColumns.map(col => {
                      if (col.format === 'irr') return <td key={col.sortKey} className="px-3 py-2 text-right font-mono">{fmtIrr(data.portfolioIRR)}</td>
                      if (col.sortKey === 'moic') return <td key={col.sortKey} className="px-3 py-2 text-right font-mono">{fmtMoic(groupTotals.moic)}</td>
                      return <td key={col.sortKey} className="px-3 py-2 text-right font-mono">{fmtVal(col.getValue(groupTotals as unknown as GroupSummary), col.format)}</td>
                    })}
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                  </tr>
                )}
                {sortedGroups.map(g => {
                  const fm = fundMetricsByGroup.get(g.group)
                  return (
                    <tr key={g.group} className="border-b last:border-b-0 hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium sticky left-0 bg-background z-10">{g.group || '(none)'}</td>
                      {groupNumericColumns.map(col => (
                        <td key={col.sortKey} className="px-3 py-2 text-right font-mono">{fmtVal(col.getValue(g), col.format)}</td>
                      ))}
                      <td className="px-3 py-2 text-right font-mono">{fmtMoic(fm?.tvpi ?? null)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtMoic(fm?.dpi ?? null)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtMoic(fm?.rvpi ?? null)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtIrr(fm?.netIrr ?? null)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="border rounded px-2 py-1 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="exited">Exited</option>
          <option value="written-off">Written Off</option>
        </select>
        {availableGroups.length > 0 && (
          <select
            value={groupFilter}
            onChange={e => setGroupFilter(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="">All Groups</option>
            {availableGroups.map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        )}
        <select
          value={companyFilter}
          onChange={e => setCompanyFilter(e.target.value)}
          className="border rounded px-2 py-1 text-sm"
        >
          <option value="">All Companies</option>
          {availableCompanies.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b bg-muted">
              <th className="text-left px-3 py-2 font-medium sticky left-0 bg-muted z-10">
                <button onClick={() => handleSort('companyName')} className="hover:text-foreground">
                  Company<SortIcon col="companyName" />
                </button>
              </th>
              <th className="text-left px-3 py-2 font-medium">
                <button onClick={() => handleSort('status')} className="hover:text-foreground">
                  Status<SortIcon col="status" />
                </button>
              </th>
              <th className="text-left px-3 py-2 font-medium">
                <button onClick={() => handleSort('portfolioGroup')} className="hover:text-foreground">
                  Group<SortIcon col="portfolioGroup" />
                </button>
              </th>
              {companyNumericColumns.map(col => (
                <th key={col.sortKey} className="text-right px-3 py-2 font-medium">
                  <button onClick={() => handleSort(col.sortKey)} className="hover:text-foreground">
                    {col.label}<SortIcon col={col.sortKey} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b bg-blue-50 dark:bg-blue-950 font-medium">
              <td className="px-3 py-2 sticky left-0 bg-blue-50 dark:bg-blue-950 z-10">Total ({filtered.length})</td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2" />
              {companyNumericColumns.map(col => {
                if (col.format === 'irr') return <td key={col.sortKey} className="px-3 py-2 text-right font-mono">{fmtIrr(data.portfolioIRR)}</td>
                if (col.sortKey === 'moic') return <td key={col.sortKey} className="px-3 py-2 text-right font-mono">{fmtMoic(totals.moic)}</td>
                return <td key={col.sortKey} className="px-3 py-2 text-right font-mono">{fmtVal(col.getValue(totals as unknown as CompanySummary), col.format)}</td>
              })}
            </tr>
            {filtered.map(c => {
              const pctTV = pctOfGroupTotalValue(c)
              return (
              <tr key={`${c.companyId}-${c.portfolioGroup.join('')}`} className="border-b last:border-b-0 hover:bg-muted/30">
                <td className="px-3 py-2 sticky left-0 bg-background z-10">
                  <Link href={`/companies/${c.companyId}`} className="font-medium hover:underline">
                    {c.companyName}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <span className={`text-xs capitalize ${STATUS_COLORS[c.status]}`}>
                    {c.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">
                  {c.portfolioGroup.length > 0 ? c.portfolioGroup.join(', ') : '-'}
                </td>
                {companyNumericColumns.map(col => (
                  <td key={col.sortKey} className="px-3 py-2 text-right font-mono">{fmtVal(col.getValue(c), col.format)}</td>
                  ))}
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
    <PortfolioNotesPanel />
    <AnalystPanel />
    </div>
    </div>
    </PortfolioNotesProvider>
  )
}
