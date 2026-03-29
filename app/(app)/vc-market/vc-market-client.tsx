'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import type { PieLabelRenderProps } from 'recharts'
import {
  TrendingUp, Globe, DollarSign, Building2, BarChart3,
  Upload, RefreshCw, ExternalLink, X, FileSpreadsheet, Loader2,
  ChevronDown, ChevronUp, Search, Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import type { VCDeal, VCFilters, VCKPIs } from '@/lib/vc-market/types'
import * as XLSX from 'xlsx'

const PERIOD_OPTIONS = [
  { value: 'ytd',       label: 'YTD' },
  { value: 'q1',        label: 'Q1' },
  { value: 'q2',        label: 'Q2' },
  { value: 'q3',        label: 'Q3' },
  { value: 'q4',        label: 'Q4' },
  { value: 'last_year', label: 'Last Year' },
  { value: '2024',      label: '2024' },
  { value: '2023',      label: '2023' },
  { value: 'all',       label: 'All time' },
]

const STAGE_COLORS: Record<string, string> = {
  'Pre-Seed': '#6366f1',
  'Seed':     '#8b5cf6',
  'Series A': '#3b82f6',
  'Series B': '#0ea5e9',
  'Series C': '#14b8a6',
  'Series D': '#22c55e',
  'Series E': '#84cc16',
  'Growth':   '#f59e0b',
  'Bridge':   '#f97316',
}

const PIE_COLORS = [
  '#6366f1', '#8b5cf6', '#3b82f6', '#0ea5e9',
  '#14b8a6', '#22c55e', '#f59e0b', '#f97316', '#ef4444',
]

const COLOR_ROUNDS  = '#0F2332'
const COLOR_CAPITAL = '#22c55e'

// Bar style helpers: fill at 40% opacity, stroke at 100% same color
function barProps(color: string) {
  return {
    fill: color,
    fillOpacity: 0.4,
    stroke: color,
    strokeWidth: 1,
  }
}

function formatUSD(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toLocaleString()}`
}

function getWeekDeals(deals: VCDeal[]): VCDeal[] {
  const now = new Date()
  const startOfWeek = new Date(now)
  startOfWeek.setDate(now.getDate() - now.getDay())
  startOfWeek.setHours(0, 0, 0, 0)
  return deals
    .filter(d => {
      if (!d.deal_date) return false
      const dt = new Date(d.deal_date)
      return dt >= startOfWeek
    })
    .sort((a, b) => (b.deal_date ?? '').localeCompare(a.deal_date ?? ''))
    .slice(0, 5)
}

function computeKPIs(deals: VCDeal[]): VCKPIs {
  const capital = deals.reduce((s, d) => s + (d.amount_usd ?? 0), 0)
  const companies = new Set(deals.map(d => d.company_name.toLowerCase())).size
  const countries = new Set(deals.map(d => d.country).filter(Boolean)).size
  const withAmount = deals.filter(d => d.amount_usd)
  const avgTicket = withAmount.length > 0
    ? withAmount.reduce((s, d) => s + (d.amount_usd ?? 0), 0) / withAmount.length
    : 0
  return { totalRounds: deals.length, totalCapital: capital, uniqueCompanies: companies, avgTicket, activeCountries: countries }
}

function buildRoundsByMonth(deals: VCDeal[]) {
  const map = new Map<string, number>()
  for (const d of deals) {
    if (!d.deal_date) continue
    const month = d.deal_date.slice(0, 7)
    map.set(month, (map.get(month) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({
      month: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      rounds: count,
    }))
}

function buildCapitalByMonth(deals: VCDeal[]) {
  const map = new Map<string, number>()
  for (const d of deals) {
    if (!d.deal_date || !d.amount_usd) continue
    const month = d.deal_date.slice(0, 7)
    map.set(month, (map.get(month) ?? 0) + d.amount_usd)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, capital]) => ({
      month: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      capital,
    }))
}

function buildCapitalBySegment(deals: VCDeal[]) {
  const map = new Map<string, number>()
  for (const d of deals) {
    const seg = d.segment ?? 'Other'
    map.set(seg, (map.get(seg) ?? 0) + (d.amount_usd ?? 0))
  }
  return Array.from(map.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([segment, amount]) => ({ segment, amount }))
}

function buildRoundsByVertical(deals: VCDeal[]) {
  const map = new Map<string, number>()
  for (const d of deals) {
    const seg = d.segment ?? 'Other'
    map.set(seg, (map.get(seg) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([segment, rounds]) => ({ segment, rounds }))
}

function buildDealsByCountry(deals: VCDeal[]) {
  const map = new Map<string, number>()
  for (const d of deals) {
    const c = d.country ?? 'Unknown'
    map.set(c, (map.get(c) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 12)
    .map(([country, count]) => ({ country, deals: count }))
}

function buildCapitalByCountry(deals: VCDeal[]) {
  const map = new Map<string, number>()
  for (const d of deals) {
    if (!d.amount_usd) continue
    const c = d.country ?? 'Unknown'
    map.set(c, (map.get(c) ?? 0) + d.amount_usd)
  }
  return Array.from(map.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 12)
    .map(([country, capital]) => ({ country, capital }))
}

function getUniqueValues(deals: VCDeal[], key: keyof VCDeal): string[] {
  const set = new Set<string>()
  for (const d of deals) {
    const v = d[key]
    if (v && typeof v === 'string') set.add(v)
  }
  return Array.from(set).sort()
}

function getUniqueInvestors(deals: VCDeal[]): string[] {
  const set = new Set<string>()
  for (const d of deals) {
    for (const inv of d.investors ?? []) {
      if (inv) set.add(inv)
    }
  }
  return Array.from(set).sort()
}

const fmtRounds  = (v: number | undefined) => [v ?? 0, 'Rounds']  as [number, string]
const fmtDeals   = (v: number | undefined) => [v ?? 0, 'Deals']   as [number, string]
const fmtCapital = (v: number | undefined) => [formatUSD(v ?? 0), 'Capital'] as [string, string]
const fmtUSDAxis = (v: number | undefined) => formatUSD(v ?? 0)

function ImportModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleImport = async () => {
    if (!file) return
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/vc-market/import', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Import failed')
      toast.success(`Imported ${data.inserted} deals${data.skipped > 0 ? ` (${data.skipped} skipped)` : ''}`)
      if (data.errors?.length) toast.error(`${data.errors.length} row error(s) — check format`)
      onSuccess()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setLoading(false)
    }
  }

  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Company Name', 'Amount USD', 'Date', 'Stage', 'Investors', 'Segment', 'Country', 'Source URL'],
      ['Acme Corp', 5000000, '2026-01-15', 'Series A', 'Sequoia, a16z', 'Fintech', 'BR', 'https://techcrunch.com/...'],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'VC Deals')
    XLSX.writeFile(wb, 'vc-market-template.xlsx')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Import Deals from Excel</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Upload an <code>.xlsx</code> or <code>.csv</code> file with deal data.
          Columns: <strong>Company Name, Amount USD, Date, Stage, Investors, Segment, Country, Source URL</strong>.
        </p>
        <div
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors mb-4 ${
            file ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
          }`}
        >
          <FileSpreadsheet className={`h-8 w-8 mx-auto mb-2 ${file ? 'text-primary' : 'text-muted-foreground'}`} />
          {file ? <p className="text-sm font-medium">{file.name}</p> : <p className="text-sm text-muted-foreground">Click to select file</p>}
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="flex-1">Download Template</Button>
          <Button size="sm" onClick={handleImport} disabled={!file || loading} className="flex-1">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
            Import
          </Button>
        </div>
      </div>
    </div>
  )
}

function KPICard({ label, value, icon: Icon, color }: {
  label: string; value: string; icon: React.ElementType; color: string
}) {
  return (
    <div className="bg-card border rounded-xl p-4 flex items-center gap-4">
      <div className={`p-2.5 rounded-lg ${color}`}><Icon className="h-5 w-5" /></div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  )
}

function DealRow({ deal }: { deal: VCDeal }) {
  const stageColor = deal.stage ? STAGE_COLORS[deal.stage] ?? '#94a3b8' : '#94a3b8'
  return (
    <tr className="border-b last:border-0 hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3 font-medium text-sm">{deal.company_name}</td>
      <td className="px-4 py-3 text-sm tabular-nums">
        {deal.amount_usd ? formatUSD(deal.amount_usd) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {deal.deal_date ? new Date(deal.deal_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
      </td>
      <td className="px-4 py-3">
        {deal.stage
          ? <span className="text-xs font-medium px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: stageColor }}>{deal.stage}</span>
          : <span className="text-muted-foreground text-sm">—</span>}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground max-w-[180px] truncate">
        {deal.investors?.length > 0 ? deal.investors.join(', ') : '—'}
      </td>
      <td className="px-4 py-3 text-sm">
        {deal.segment ? <Badge variant="secondary" className="text-xs">{deal.segment}</Badge> : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">{deal.country ?? '—'}</td>
      <td className="px-4 py-3">
        {deal.source_url
          ? <a href={deal.source_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1 text-xs">Link <ExternalLink className="h-3 w-3" /></a>
          : <span className="text-muted-foreground text-sm">—</span>}
      </td>
    </tr>
  )
}

interface Props { isAdmin: boolean }

export function VCMarketClient({ isAdmin }: Props) {
  const [deals, setDeals]           = useState<VCDeal[]>([])
  const [loading, setLoading]       = useState(true)
  const [scraping, setScraping]     = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [search, setSearch]         = useState('')
  const [sortKey, setSortKey]       = useState<keyof VCDeal>('deal_date')
  const [sortDir, setSortDir]       = useState<'asc' | 'desc'>('desc')
  const [page, setPage]             = useState(1)
  const PAGE_SIZE = 50

  const [filters, setFilters] = useState<VCFilters>({
    period: 'ytd', country: '', segment: '', stage: '', investor: '',
  })
  const [allDeals, setAllDeals] = useState<VCDeal[]>([])

  const fetchDeals = useCallback(async (f: VCFilters) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (f.period)   params.set('period',   f.period)
      if (f.country)  params.set('country',  f.country)
      if (f.segment)  params.set('segment',  f.segment)
      if (f.stage)    params.set('stage',    f.stage)
      if (f.investor) params.set('investor', f.investor)
      const res = await fetch(`/api/vc-market/deals?${params}`)
      const data = await res.json()
      setDeals(data.deals ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchAllDeals = useCallback(async (period: string) => {
    const params = new URLSearchParams({ period })
    const res = await fetch(`/api/vc-market/deals?${params}`)
    const data = await res.json()
    setAllDeals(data.deals ?? [])
  }, [])

  useEffect(() => { fetchDeals(filters) }, [fetchDeals, filters])
  useEffect(() => { fetchAllDeals(filters.period) }, [fetchAllDeals, filters.period])

  const setFilter = (key: keyof VCFilters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }))
    setPage(1)
  }

  const handleScrape = async () => {
    setScraping(true)
    try {
      const res = await fetch('/api/vc-market/scrape', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Scrape failed')
      toast.success(`Scrape complete: ${data.inserted} new deals${data.skipped > 0 ? `, ${data.skipped} dupes skipped` : ''}`)
      fetchDeals(filters)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Scrape failed')
    } finally {
      setScraping(false)
    }
  }

  const kpis             = computeKPIs(deals)
  const weekDeals        = getWeekDeals(deals)
  const roundsByMonth    = buildRoundsByMonth(deals)
  const capitalByMonth   = buildCapitalByMonth(deals)
  const capitalBySegment = buildCapitalBySegment(deals)
  const roundsByVertical = buildRoundsByVertical(deals)
  const dealsByCountry   = buildDealsByCountry(deals)
  const capitalByCountry = buildCapitalByCountry(deals)

  const countryOptions  = getUniqueValues(allDeals, 'country')
  const segmentOptions  = getUniqueValues(allDeals, 'segment')
  const stageOptions    = getUniqueValues(allDeals, 'stage')
  const investorOptions = getUniqueInvestors(allDeals)

  const toggleSort = (key: keyof VCDeal) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
    setPage(1)
  }

  const filtered = deals.filter(d => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      d.company_name.toLowerCase().includes(q) ||
      (d.segment ?? '').toLowerCase().includes(q) ||
      (d.country ?? '').toLowerCase().includes(q) ||
      (d.stage ?? '').toLowerCase().includes(q) ||
      d.investors.some(i => i.toLowerCase().includes(q))
    )
  })

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey] ?? ''
    const bv = b[sortKey] ?? ''
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const SortIcon = ({ col }: { col: keyof VCDeal }) => {
    if (sortKey !== col) return null
    return sortDir === 'asc'
      ? <ChevronUp className="h-3 w-3 inline ml-0.5" />
      : <ChevronDown className="h-3 w-3 inline ml-0.5" />
  }

  const emptyChart = (msg: string) => (
    <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">{msg}</div>
  )

  return (
    <div className="p-4 md:py-8 md:px-8 space-y-6 max-w-[1600px]">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">VC Market</h1>
          <p className="text-sm text-muted-foreground">Global venture capital deal flow — scraped daily & importable</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={handleScrape} disabled={scraping}>
              {scraping ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
              Scrape now
            </Button>
          )}
          <Button size="sm" onClick={() => setShowImport(true)}>
            <Upload className="h-4 w-4 mr-1.5" />Import Excel
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={filters.period} onValueChange={v => setFilter('period', v)}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Period" /></SelectTrigger>
          <SelectContent>{PERIOD_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filters.country || '_all'} onValueChange={v => setFilter('country', v === '_all' ? '' : v)}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Country" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All countries</SelectItem>
            {countryOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.segment || '_all'} onValueChange={v => setFilter('segment', v === '_all' ? '' : v)}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Segment" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All segments</SelectItem>
            {segmentOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.stage || '_all'} onValueChange={v => setFilter('stage', v === '_all' ? '' : v)}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Stage" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All stages</SelectItem>
            {stageOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.investor || '_all'} onValueChange={v => setFilter('investor', v === '_all' ? '' : v)}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Investor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All investors</SelectItem>
            {investorOptions.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
          </SelectContent>
        </Select>
        {(filters.country || filters.segment || filters.stage || filters.investor) && (
          <button onClick={() => setFilters(f => ({ ...f, country: '', segment: '', stage: '', investor: '' }))}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <X className="h-3 w-3" /> Clear
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {loading ? 'Loading…' : `${deals.length} deal${deals.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KPICard label="Total Rounds"     value={kpis.totalRounds.toLocaleString()}                         icon={BarChart3}  color="bg-indigo-500/10 text-indigo-500" />
        <KPICard label="Total Capital"    value={kpis.totalCapital > 0 ? formatUSD(kpis.totalCapital) : '—'} icon={DollarSign} color="bg-emerald-500/10 text-emerald-500" />
        <KPICard label="Unique Companies" value={kpis.uniqueCompanies.toLocaleString()}                     icon={Building2}  color="bg-blue-500/10 text-blue-500" />
        <KPICard label="Avg Ticket"       value={kpis.avgTicket > 0 ? formatUSD(kpis.avgTicket) : '—'}      icon={TrendingUp} color="bg-violet-500/10 text-violet-500" />
        <KPICard label="Active Countries" value={kpis.activeCountries.toLocaleString()}                     icon={Globe}      color="bg-amber-500/10 text-amber-500" />
      </div>

      {/* Deals This Week */}
      {!loading && weekDeals.length > 0 && (
        <div className="bg-card border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-medium">Deals This Week</h3>
            <span className="ml-auto text-xs text-muted-foreground">{weekDeals.length} deal{weekDeals.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="divide-y">
            {weekDeals.map(deal => (
              <div key={deal.id} className="px-4 py-3 flex items-center gap-4 hover:bg-muted/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{deal.company_name}</p>
                  {deal.stage && (
                    <span
                      className="text-xs font-medium px-1.5 py-0.5 rounded-full text-white mt-0.5 inline-block"
                      style={{ backgroundColor: STAGE_COLORS[deal.stage] ?? '#94a3b8' }}
                    >
                      {deal.stage}
                    </span>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {deal.amount_usd ? formatUSD(deal.amount_usd) : '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {deal.deal_date
                      ? new Date(deal.deal_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      : '—'}
                  </p>
                </div>
                {deal.source_url ? (
                  <a href={deal.source_url} target="_blank" rel="noopener noreferrer"
                    className="shrink-0 text-muted-foreground hover:text-primary transition-colors">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                ) : <div className="shrink-0 w-4" />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts — order: Rounds/Month, Capital/Month, Rounds/Vertical, Capital/Vertical, Deals/Country, Capital/Country */}
      {!loading && deals.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* 1. Rounds by Month */}
          <div className="bg-card border rounded-xl p-4">
            <h3 className="text-sm font-medium mb-4">Rounds by Month</h3>
            {roundsByMonth.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={roundsByMonth} margin={{ top: 0, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={fmtRounds} />
                  <Bar dataKey="rounds" {...barProps(COLOR_ROUNDS)} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : emptyChart('No dated deals in period')}
          </div>

          {/* 2. Capital by Month */}
          <div className="bg-card border rounded-xl p-4">
            <h3 className="text-sm font-medium mb-4">Capital by Month (USD)</h3>
            {capitalByMonth.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={capitalByMonth} margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtUSDAxis} width={56} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={fmtCapital} />
                  <Bar dataKey="capital" {...barProps(COLOR_CAPITAL)} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : emptyChart('No capital data in period')}
          </div>

          {/* 3. Rounds by Vertical */}
          <div className="bg-card border rounded-xl p-4">
            <h3 className="text-sm font-medium mb-4">Rounds by Vertical</h3>
            {roundsByVertical.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={roundsByVertical} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis dataKey="segment" type="category" tick={{ fontSize: 11 }} width={60} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={fmtRounds} />
                  <Bar dataKey="rounds" {...barProps(COLOR_ROUNDS)} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : emptyChart('No vertical data available')}
          </div>

          {/* 4. Capital by Vertical */}
          <div className="bg-card border rounded-xl p-4">
            <h3 className="text-sm font-medium mb-4">Capital by Vertical (USD)</h3>
            {capitalBySegment.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={capitalBySegment} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmtUSDAxis} />
                  <YAxis dataKey="segment" type="category" tick={{ fontSize: 11 }} width={60} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={fmtCapital} />
                  <Bar dataKey="amount" {...barProps(COLOR_CAPITAL)} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : emptyChart('No capital data available')}
          </div>

          {/* 5. Deals by Country */}
          <div className="bg-card border rounded-xl p-4">
            <h3 className="text-sm font-medium mb-4">Deals by Country</h3>
            {dealsByCountry.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={dealsByCountry} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis dataKey="country" type="category" tick={{ fontSize: 11 }} width={60} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={fmtDeals} />
                  <Bar dataKey="deals" radius={[0, 3, 3, 0]}>
                    {dealsByCountry.map((_, i) => {
                      const c = PIE_COLORS[i % PIE_COLORS.length]
                      return <Cell key={i} fill={c} fillOpacity={0.2} stroke={c} strokeWidth={1} />
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : emptyChart('No country data available')}
          </div>

          {/* 6. Capital by Country */}
          <div className="bg-card border rounded-xl p-4">
            <h3 className="text-sm font-medium mb-4">Capital by Country (USD)</h3>
            {capitalByCountry.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={capitalByCountry} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmtUSDAxis} />
                  <YAxis dataKey="country" type="category" tick={{ fontSize: 11 }} width={60} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={fmtCapital} />
                  <Bar dataKey="capital" radius={[0, 3, 3, 0]}>
                    {capitalByCountry.map((_, i) => {
                      const c = PIE_COLORS[i % PIE_COLORS.length]
                      return <Cell key={i} fill={c} fillOpacity={0.4} stroke={c} strokeWidth={1} />
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : emptyChart('No capital by country data')}
          </div>

        </div>
      )}

      {/* Empty state */}
      {!loading && deals.length === 0 && (
        <div className="bg-card border rounded-xl p-12 text-center">
          <TrendingUp className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="font-medium mb-1">No deals yet</p>
          <p className="text-sm text-muted-foreground mb-4">Import an Excel file or trigger a scrape to populate deal data.</p>
          <div className="flex items-center justify-center gap-2">
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={handleScrape} disabled={scraping}>
                {scraping ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                Scrape now
              </Button>
            )}
            <Button size="sm" onClick={() => setShowImport(true)}>
              <Upload className="h-4 w-4 mr-1" /> Import Excel
            </Button>
          </div>
        </div>
      )}

      {/* Deals Table */}
      {deals.length > 0 && (
        <div className="bg-card border rounded-xl overflow-hidden">
          <div className="p-4 border-b flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">All Deals</h3>
            <div className="relative w-60">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
                placeholder="Search…" className="pl-8 h-8 text-xs" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b bg-muted/30 text-muted-foreground text-xs">
                  {([
                    ['company_name', 'Company'],
                    ['amount_usd',   'Amount'],
                    ['deal_date',    'Date'],
                    ['stage',        'Stage'],
                    ['investors',    'Investors'],
                    ['segment',      'Segment'],
                    ['country',      'Country'],
                    [null,           'Source'],
                  ] as [keyof VCDeal | null, string][]).map(([key, label]) => (
                    <th key={label}
                      className={`px-4 py-2.5 text-left font-medium ${key ? 'cursor-pointer select-none hover:text-foreground' : ''}`}
                      onClick={() => key && toggleSort(key)}>
                      {label}{key && <SortIcon col={key} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.length === 0
                  ? <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground text-sm">No deals match your search</td></tr>
                  : paged.map(deal => <DealRow key={deal.id} deal={deal} />)}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="p-3 border-t flex items-center justify-between text-xs text-muted-foreground">
              <span>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} of {sorted.length}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {showImport && <ImportModal onClose={() => setShowImport(false)} onSuccess={() => fetchDeals(filters)} />}
    </div>
  )
}
