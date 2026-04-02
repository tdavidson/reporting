'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
  PieChart, Pie, Legend
} from 'recharts'
import {
  TrendingUp, Globe, DollarSign, Building2, BarChart3,
  ChevronDown, ChevronUp, Search, Filter, X, AlertCircle,
  RefreshCw, Plus, ExternalLink, Loader2, ChevronLeft, ChevronRight,
  SlidersHorizontal, Download, Calendar, Check, BookOpen
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/lib/hooks/use-user'
import { useOrganization } from '@/lib/hooks/use-organization'
import { formatCurrency } from '@/lib/format'
import { useDisplayUnit } from '@/components/display-unit-context'
import { ScrapeReportModal } from './scrape-report-modal'
import { ReviewModal } from './review-modal'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Deal {
  id: string
  company_name: string
  amount_usd: number | null
  round_type: string | null
  vertical: string | null
  country: string | null
  city: string | null
  announced_date: string | null
  source_url: string | null
  source_name: string | null
  investors: string[] | null
  description: string | null
  tags: string[] | null
  status: string
  created_at: string
  reviewed_at: string | null
  reviewed_by: string | null
  org_id: string
}

interface KPIs {
  totalRounds: number
  totalCapital: number
  avgDeal: number
  topVertical: string
  topCountry: string
}

interface ChartRow { name: string; value: number }

// ─── Constants ───────────────────────────────────────────────────────────────

const COLOR_ROUNDS  = '#6366f1'
const COLOR_CAPITAL = '#22c55e'

const PIE_COLORS = [
  '#6366f1','#22c55e','#f59e0b','#ef4444','#3b82f6',
  '#a855f7','#14b8a6','#f97316','#84cc16','#ec4899',
]

const LABEL_STYLE_ROUNDS  = { fontSize: 11, fill: '#6366f1', fontWeight: 600 }
const LABEL_STYLE_CAPITAL = { fontSize: 11, fill: '#16a34a', fontWeight: 600 }
const LABEL_STYLE_COUNTRY = { fontSize: 11, fill: '#6b7280', fontWeight: 600 }

const ROUND_TYPES = [
  'Pre-Seed','Seed','Series A','Series B','Series C',
  'Series D','Series E','Series F','Growth','Bridge',
  'Convertible Note','SAFE','Venture Debt','Strategic','Other',
]

const VERTICAL_OPTIONS = [
  'Fintech','EdTech','HealthTech','AgriTech','CleanTech',
  'Proptech','Logistics','SaaS','AI/ML','Cybersecurity',
  'Marketplace','E-commerce','Gaming','Media','Deep Tech',
  'BioTech','LegalTech','HRTech','Insurtech','Other',
]

const PAGE_SIZE = 25

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtUSD(v: number) {
  if (v >= 1_000_000_000) return `$${(v/1_000_000_000).toFixed(1)}B`
  if (v >= 1_000_000)     return `$${(v/1_000_000).toFixed(1)}M`
  if (v >= 1_000)         return `$${(v/1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function fmtUSDAxis(v: number) { return fmtUSD(v) }

function fmtRounds(_v: unknown, _n: unknown, p: { value: number }) {
  return [`${p.value} round${p.value !== 1 ? 's' : ''}`, '']
}
function fmtCapital(_v: unknown, _n: unknown, p: { value: number }) {
  return [fmtUSD(p.value), '']
}
function fmtDeals(_v: unknown, _n: unknown, p: { value: number }) {
  return [`${p.value} deal${p.value !== 1 ? 's' : ''}`, '']
}

function labelFmtRounds(v: number) { return v }
function labelFmtUSD(v: number)    { return fmtUSD(v) }

function horzH(n: number) { return Math.max(180, n * 36) }

function barProps(color: string) {
  return { fill: color, fillOpacity: 0.75, stroke: color, strokeWidth: 1 } as const
}

function parseDate(s: string | null) {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function formatDate(s: string | null) {
  const d = parseDate(s)
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KPICard({ label, value, icon: Icon, color }: {
  label: string; value: string; icon: React.ElementType; color: string
}) {
  return (
    <div className="bg-card border rounded-xl p-4 flex items-start gap-3">
      <div className={`p-2 rounded-lg ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className="text-lg font-semibold tracking-tight truncate">{value}</p>
      </div>
    </div>
  )
}

function emptyChart(msg: string) {
  return (
    <div className="flex items-center justify-center h-[180px] text-sm text-muted-foreground">
      {msg}
    </div>
  )
}

// ─── Dropdown helpers ─────────────────────────────────────────────────────────

function MultiSelectDropdown({
  label, options, selected, onToggle, onClear,
}: {
  label: string
  options: string[]
  selected: string[]
  onToggle: (v: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-medium bg-background hover:bg-accent transition-colors"
      >
        {label}
        {selected.length > 0 && (
          <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px] font-semibold">
            {selected.length}
          </span>
        )}
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 min-w-[160px] max-h-56 overflow-y-auto bg-popover border rounded-md shadow-md py-1">
          {selected.length > 0 && (
            <button onClick={onClear}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent text-left">
              <X className="h-3 w-3" /> Clear all
            </button>
          )}
          {options.map(o => (
            <button key={o} onClick={() => onToggle(o)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent text-left">
              <span className={`h-3.5 w-3.5 rounded border flex items-center justify-center ${
                selected.includes(o) ? 'bg-primary border-primary' : 'border-border'
              }`}>
                {selected.includes(o) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
              </span>
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SingleSelectDropdown({
  label, options, value, onChange,
}: {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const current = options.find(o => o.value === value)

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-medium bg-background hover:bg-accent transition-colors"
      >
        {current?.label ?? label}
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 min-w-[200px] max-h-48 overflow-y-auto bg-popover border rounded-md shadow-md py-1">
          {options.map(o => (
            <button key={o.value} onClick={() => { onChange(o.value); setOpen(false) }}
              className="w-full px-3 py-1.5 text-xs hover:bg-accent text-left truncate">
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Deal tooltip ─────────────────────────────────────────────────────────────

function DealTooltip({ deal }: { deal: Deal }) {
  return (
    <div className="absolute bottom-full left-0 mb-2 z-50 bg-popover border rounded-lg shadow-lg p-2.5 min-w-[160px] max-w-[280px]">
      <p className="font-semibold text-xs mb-1 truncate">{deal.company_name}</p>
      {deal.description && (
        <p className="text-[11px] text-muted-foreground line-clamp-3 mb-1">{deal.description}</p>
      )}
      {deal.investors && deal.investors.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          <span className="font-medium">Investors: </span>
          {deal.investors.slice(0, 3).join(', ')}
          {deal.investors.length > 3 && ` +${deal.investors.length - 3}`}
        </p>
      )}
      <div className="absolute top-full left-4 -mt-px w-2.5 h-2.5 bg-popover border-b border-r border-border rotate-45" />
    </div>
  )
}

// ─── Table row ────────────────────────────────────────────────────────────────

function DealRow({
  deal,
  onReview,
  isAdmin,
}: {
  deal: Deal
  onReview: (deal: Deal) => void
  isAdmin: boolean
}) {
  const [hover, setHover] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function startHover() {
    timerRef.current = setTimeout(() => setHover(true), 400)
  }
  function endHover() {
    if (timerRef.current) clearTimeout(timerRef.current)
    setHover(false)
  }

  const statusColor =
    deal.status === 'approved' ? 'bg-green-500/10 text-green-600 border-green-200' :
    deal.status === 'rejected' ? 'bg-red-500/10 text-red-600 border-red-200' :
    'bg-yellow-500/10 text-yellow-600 border-yellow-200'

  return (
    <tr
      className="group border-b last:border-0 hover:bg-muted/30 transition-colors"
      onMouseEnter={startHover}
      onMouseLeave={endHover}
    >
      <td className="px-4 py-3 font-medium text-sm sticky left-0 z-10 bg-card group-hover:bg-muted/30 transition-colors whitespace-nowrap">
        <div className="relative">
          <span
            className="hover:underline cursor-pointer"
            onClick={() => onReview(deal)}
          >
            {deal.company_name}
          </span>
          {hover && <DealTooltip deal={deal} />}
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-right tabular-nums">
        {deal.amount_usd ? fmtUSD(deal.amount_usd) : '—'}
      </td>
      <td className="px-4 py-3 text-sm">
        {deal.round_type ? (
          <Badge variant="outline" className="text-xs whitespace-nowrap">{deal.round_type}</Badge>
        ) : '—'}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">{deal.vertical ?? '—'}</td>
      <td className="px-4 py-3 text-sm text-muted-foreground">{deal.country ?? '—'}</td>
      <td className="px-4 py-3 text-sm text-muted-foreground">{formatDate(deal.announced_date)}</td>
      <td className="px-4 py-3">
        <Badge variant="outline" className={`text-[10px] capitalize ${statusColor}`}>
          {deal.status}
        </Badge>
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {deal.source_url ? (
          <a
            href={deal.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            <span className="truncate max-w-[120px]">{deal.source_name ?? 'Link'}</span>
          </a>
        ) : '—'}
      </td>
      {isAdmin && (
        <td className="px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onReview(deal)}
          >
            Review
          </Button>
        </td>
      )}
    </tr>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function VcMarketClient() {
  const supabase = createClient()
  const { user } = useUser()
  const { organization } = useOrganization()

  // ── State ──
  const [deals, setDeals]             = useState<Deal[]>([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [activeTab, setActiveTab]     = useState<'overview' | 'deals'>('overview')

  // filters
  const [search, setSearch]           = useState('')
  const [selectedRoundTypes, setSelectedRoundTypes] = useState<string[]>([])
  const [selectedVerticals, setSelectedVerticals]   = useState<string[]>([])
  const [selectedCountries, setSelectedCountries]   = useState<string[]>([])
  const [selectedStatuses, setSelectedStatuses]     = useState<string[]>([])
  const [sortField, setSortField]     = useState<'announced_date' | 'amount_usd' | 'company_name'>('announced_date')
  const [sortDir, setSortDir]         = useState<'desc' | 'asc'>('desc')
  const [page, setPage]               = useState(1)

  const [selectedPeriod, setSelectedPeriod] = useState('all')
  const [reviewDeal, setReviewDeal]         = useState<Deal | null>(null)
  const [showScrapeReport, setShowScrapeReport] = useState(false)

  const isAdmin = organization?.role === 'admin' || organization?.role === 'owner'

  // ── Load deals ──
  const loadDeals = useCallback(async () => {
    if (!organization?.id) return
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await supabase
        .from('vc_market_deals')
        .select('*')
        .eq('org_id', organization.id)
        .order('announced_date', { ascending: false })

      if (error) throw error
      setDeals(data ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load deals')
    } finally {
      setLoading(false)
    }
  }, [organization?.id, supabase])

  useEffect(() => { loadDeals() }, [loadDeals])

  // ── Period filter ──
  const periodOptions = [
    { value: 'all',     label: 'All time' },
    { value: '7d',      label: 'Last 7 days' },
    { value: '30d',     label: 'Last 30 days' },
    { value: '90d',     label: 'Last 90 days' },
    { value: '180d',    label: 'Last 6 months' },
    { value: '1y',      label: 'Last year' },
    { value: 'ytd',     label: 'Year to date' },
  ]

  function periodCutoff(p: string): Date | null {
    const now = new Date()
    if (p === 'all')  return null
    if (p === '7d')   return new Date(now.getTime() - 7   * 86400000)
    if (p === '30d')  return new Date(now.getTime() - 30  * 86400000)
    if (p === '90d')  return new Date(now.getTime() - 90  * 86400000)
    if (p === '180d') return new Date(now.getTime() - 180 * 86400000)
    if (p === '1y')   return new Date(now.getTime() - 365 * 86400000)
    if (p === 'ytd')  return new Date(now.getFullYear(), 0, 1)
    return null
  }

  // ── Derived / filtered data ──
  const cutoff = periodCutoff(selectedPeriod)

  const periodDeals = deals.filter(d => {
    if (!cutoff) return true
    const dt = parseDate(d.announced_date)
    return dt ? dt >= cutoff : false
  })

  const availableCountries = Array.from(
    new Set(periodDeals.map(d => d.country).filter(Boolean) as string[])
  ).sort()

  const filteredDeals = periodDeals.filter(d => {
    const q = search.toLowerCase()
    if (q && ![
      d.company_name, d.round_type, d.vertical, d.country, d.city,
      ...(d.investors ?? []), ...(d.tags ?? []),
    ].some(v => v?.toLowerCase().includes(q))) return false
    if (selectedRoundTypes.length && !selectedRoundTypes.includes(d.round_type ?? '')) return false
    if (selectedVerticals.length  && !selectedVerticals.includes(d.vertical ?? ''))   return false
    if (selectedCountries.length  && !selectedCountries.includes(d.country ?? ''))    return false
    if (selectedStatuses.length   && !selectedStatuses.includes(d.status))            return false
    return true
  })

  const sortedDeals = [...filteredDeals].sort((a, b) => {
    let av: string | number | null, bv: string | number | null
    if (sortField === 'announced_date') {
      av = a.announced_date; bv = b.announced_date
      const ad = parseDate(av); const bd = parseDate(bv)
      if (!ad && !bd) return 0
      if (!ad) return 1; if (!bd) return -1
      return sortDir === 'desc' ? bd.getTime() - ad.getTime() : ad.getTime() - bd.getTime()
    }
    if (sortField === 'amount_usd') {
      av = a.amount_usd ?? -1; bv = b.amount_usd ?? -1
      return sortDir === 'desc' ? (bv as number) - (av as number) : (av as number) - (bv as number)
    }
    av = a.company_name ?? ''; bv = b.company_name ?? ''
    return sortDir === 'desc'
      ? (bv as string).localeCompare(av as string)
      : (av as string).localeCompare(bv as string)
  })

  const totalPages  = Math.ceil(sortedDeals.length / PAGE_SIZE)
  const pagedDeals  = sortedDeals.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // ── Chart data ──
  const approvedDeals = periodDeals.filter(d => d.status === 'approved')

  const kpis: KPIs = {
    totalRounds:  approvedDeals.length,
    totalCapital: approvedDeals.reduce((s, d) => s + (d.amount_usd ?? 0), 0),
    avgDeal:      approvedDeals.length
      ? approvedDeals.reduce((s, d) => s + (d.amount_usd ?? 0), 0) / approvedDeals.filter(d => d.amount_usd).length || 0
      : 0,
    topVertical:  (() => {
      const m = new Map<string, number>()
      approvedDeals.forEach(d => { if (d.vertical) m.set(d.vertical, (m.get(d.vertical) ?? 0) + 1) })
      return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
    })(),
    topCountry: (() => {
      const m = new Map<string, number>()
      approvedDeals.forEach(d => { if (d.country) m.set(d.country, (m.get(d.country) ?? 0) + 1) })
      return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
    })(),
  }

  function groupByMonth(arr: Deal[], valueKey: 'amount_usd' | 'count') {
    const m = new Map<string, number>()
    arr.forEach(d => {
      const dt = parseDate(d.announced_date)
      if (!dt) return
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
      m.set(key, (m.get(key) ?? 0) + (valueKey === 'count' ? 1 : (d.amount_usd ?? 0)))
    })
    return Array.from(m.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({
        month: k.slice(5) + '/' + k.slice(2, 4),
        value: v,
      }))
  }

  const roundsByMonth   = groupByMonth(approvedDeals, 'count').map(r => ({ ...r, rounds: r.value }))
  const capitalByMonth  = groupByMonth(approvedDeals, 'amount_usd').map(r => ({ ...r, amount: r.value }))

  function topN<T extends object>(arr: T[], key: keyof T, valueKey: keyof T, n = 10) {
    const m = new Map<string, number>()
    arr.forEach(d => {
      const k = (d[key] as string) ?? 'Unknown'
      m.set(k, (m.get(k) ?? 0) + ((d[valueKey] as number) ?? 0))
    })
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name, value]) => ({ name, value }))
  }

  function topNCount<T extends object>(arr: T[], key: keyof T, n = 10) {
    const m = new Map<string, number>()
    arr.forEach(d => {
      const k = (d[key] as string) ?? 'Unknown'
      m.set(k, (m.get(k) ?? 0) + 1)
    })
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name, value]) => ({ name, value }))
  }

  const top10Deals = [...approvedDeals]
    .filter(d => d.amount_usd)
    .sort((a, b) => (b.amount_usd ?? 0) - (a.amount_usd ?? 0))
    .slice(0, 10)
    .map(d => ({ name: d.company_name, amount: d.amount_usd! }))

  const roundsByVertical  = topNCount(approvedDeals, 'vertical').map(r => ({ segment: r.name, rounds: r.value }))
  const capitalBySegment  = topN(approvedDeals, 'vertical', 'amount_usd').map(r => ({ segment: r.name, amount: r.value }))
  const dealsByCountry    = topNCount(approvedDeals, 'country').map(r => ({ country: r.name, deals: r.value }))
  const capitalByCountry  = topN(approvedDeals, 'country', 'amount_usd').map(r => ({ country: r.name, capital: r.value }))
  const roundsByType      = topNCount(approvedDeals, 'round_type').map(r => ({ name: r.name, value: r.value }))

  // ── Handlers ──

  function toggleSort(field: typeof sortField) {
    if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortField(field); setSortDir('desc') }
  }

  function toggleFilter<T>(setter: React.Dispatch<React.SetStateAction<T[]>>, v: T) {
    setter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])
  }

  function resetFilters() {
    setSearch(''); setSelectedRoundTypes([]); setSelectedVerticals([])
    setSelectedCountries([]); setSelectedStatuses([]); setPage(1)
  }

  const hasFilters = search || selectedRoundTypes.length || selectedVerticals.length ||
    selectedCountries.length || selectedStatuses.length

  // ─────────────────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
      </div>
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
      <AlertCircle className="h-8 w-8 text-destructive" />
      <p className="text-sm">{error}</p>
      <Button variant="outline" size="sm" onClick={loadDeals}>
        <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry
      </Button>
    </div>
  )

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-0">

      {/* ── Header bar ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <SingleSelectDropdown
            label="Period"
            options={periodOptions}
            value={selectedPeriod}
            onChange={v => { setSelectedPeriod(v); setPage(1) }}
          />
          <MultiSelectDropdown
            label="Round type"
            options={ROUND_TYPES}
            selected={selectedRoundTypes}
            onToggle={v => { toggleFilter(setSelectedRoundTypes, v); setPage(1) }}
            onClear={() => { setSelectedRoundTypes([]); setPage(1) }}
          />
          <MultiSelectDropdown
            label="Vertical"
            options={VERTICAL_OPTIONS}
            selected={selectedVerticals}
            onToggle={v => { toggleFilter(setSelectedVerticals, v); setPage(1) }}
            onClear={() => { setSelectedVerticals([]); setPage(1) }}
          />
          {availableCountries.length > 0 && (
            <MultiSelectDropdown
              label="Country"
              options={availableCountries}
              selected={selectedCountries}
              onToggle={v => { toggleFilter(setSelectedCountries, v); setPage(1) }}
              onClear={() => { setSelectedCountries([]); setPage(1) }}
            />
          )}
          {hasFilters && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1 h-8 px-3 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setShowScrapeReport(true)}
            >
              <BookOpen className="h-3.5 w-3.5" />
              Scrape Report
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={loadDeals}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex border-b px-6">
        {(['overview', 'deals'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ══════════════════════ OVERVIEW TAB ══════════════════════ */}
      {activeTab === 'overview' && !loading && deals.length > 0 && (
        <div className="p-6 space-y-6">

          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <KPICard label="Total Rounds"     value={kpis.totalRounds.toLocaleString()}                         icon={BarChart3}  color="bg-indigo-500/10 text-indigo-500" />
            <KPICard label="Total Capital"    value={fmtUSD(kpis.totalCapital)}                                  icon={DollarSign} color="bg-green-500/10 text-green-500" />
            <KPICard label="Avg Deal Size"    value={kpis.avgDeal ? fmtUSD(kpis.avgDeal) : '—'}                  icon={TrendingUp} color="bg-blue-500/10 text-blue-500" />
            <KPICard label="Top Vertical"     value={kpis.topVertical}                                           icon={Building2}  color="bg-purple-500/10 text-purple-500" />
            <KPICard label="Top Country"      value={kpis.topCountry}                                            icon={Globe}      color="bg-orange-500/10 text-orange-500" />
          </div>

          {/* Top 10 deals */}
          {top10Deals.length > 0 && (
            <div className="bg-card border rounded-xl p-4">
              <h3 className="text-sm font-medium mb-4">Top 10 Deals by Size</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={top10Deals} margin={{ top: 28, right: 16, bottom: 60, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtUSDAxis} width={56} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={fmtCapital} />
                  <Bar dataKey="amount" {...barProps(COLOR_CAPITAL)} radius={[3, 3, 0, 0]}>
                    <LabelList dataKey="amount" position="top" formatter={labelFmtUSD} style={LABEL_STYLE_CAPITAL} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Rounds by month */}
            <div className="bg-card border rounded-xl p-4">
              <h3 className="text-sm font-medium mb-4">Rounds by Month</h3>
              {roundsByMonth.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={roundsByMonth} margin={{ top: 20, right: 8, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={fmtRounds} />
                    <Bar dataKey="rounds" {...barProps(COLOR_ROUNDS)} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : emptyChart('No round data in period')}
            </div>

            {/* Capital by month */}
            <div className="bg-card border rounded-xl p-4">
              <h3 className="text-sm font-medium mb-4">Capital by Month (USD)</h3>
              {capitalByMonth.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={capitalByMonth} margin={{ top: 20, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtUSDAxis} width={56} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={fmtCapital} />
                    <Bar dataKey="amount" {...barProps(COLOR_CAPITAL)} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : emptyChart('No capital data in period')}
            </div>

            {/* Rounds by Vertical */}
            <div className="bg-card border rounded-xl p-4">
              <h3 className="text-sm font-medium mb-4">Rounds by Vertical</h3>
              {roundsByVertical.length > 0 ? (
                <ResponsiveContainer width="100%" height={horzH(roundsByVertical.length)}>
                  <BarChart data={roundsByVertical} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis dataKey="segment" type="category" tick={{ fontSize: 11 }} width={78} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={fmtRounds} />
                    <Bar dataKey="rounds" {...barProps(COLOR_ROUNDS)} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="rounds" position="right" formatter={labelFmtRounds} style={LABEL_STYLE_ROUNDS} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : emptyChart('No vertical data available')}
            </div>

            {/* Capital by Vertical */}
            <div className="bg-card border rounded-xl p-4">
              <h3 className="text-sm font-medium mb-4">Capital by Vertical (USD)</h3>
              {capitalBySegment.length > 0 ? (
                <ResponsiveContainer width="100%" height={horzH(capitalBySegment.length)}>
                  <BarChart data={capitalBySegment} layout="vertical" margin={{ top: 0, right: 60, bottom: 0, left: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmtUSDAxis} />
                    <YAxis dataKey="segment" type="category" tick={{ fontSize: 11 }} width={78} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={fmtCapital} />
                    <Bar dataKey="amount" {...barProps(COLOR_CAPITAL)} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="amount" position="right" formatter={labelFmtUSD} style={LABEL_STYLE_CAPITAL} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : emptyChart('No capital data available')}
            </div>

            {/* Deals by Country */}
            <div className="bg-card border rounded-xl p-4">
              <h3 className="text-sm font-medium mb-4">Deals by Country</h3>
              {dealsByCountry.length > 0 ? (
                <ResponsiveContainer width="100%" height={horzH(dealsByCountry.length)}>
                  <BarChart data={dealsByCountry} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis dataKey="country" type="category" tick={{ fontSize: 11 }} width={78} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={fmtDeals} />
                    <Bar dataKey="deals" radius={[0, 3, 3, 0]}>
                      {dealsByCountry.map((_, i) => { const c = PIE_COLORS[i % PIE_COLORS.length]; return <Cell key={i} fill={c} fillOpacity={0.6} stroke={c} strokeWidth={1.5} /> })
                      }
                      <LabelList dataKey="deals" position="right" formatter={labelFmtRounds} style={LABEL_STYLE_COUNTRY} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : emptyChart('No country data available')}
            </div>

            {/* Capital by Country */}
            <div className="bg-card border rounded-xl p-4">
              <h3 className="text-sm font-medium mb-4">Capital by Country (USD)</h3>
              {capitalByCountry.length > 0 ? (
                <ResponsiveContainer width="100%" height={horzH(capitalByCountry.length)}>
                  <BarChart data={capitalByCountry} layout="vertical" margin={{ top: 0, right: 60, bottom: 0, left: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmtUSDAxis} />
                    <YAxis dataKey="country" type="category" tick={{ fontSize: 11 }} width={78} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={fmtCapital} />
                    <Bar dataKey="capital" radius={[0, 3, 3, 0]}>
                      {capitalByCountry.map((_, i) => { const c = PIE_COLORS[i % PIE_COLORS.length]; return <Cell key={i} fill={c} fillOpacity={0.6} stroke={c} strokeWidth={1.5} /> })
                      }
                      <LabelList dataKey="capital" position="right" formatter={labelFmtUSD} style={LABEL_STYLE_COUNTRY} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : emptyChart('No capital by country data')}
            </div>
          </div>

          {/* Round type pie */}
          {roundsByType.length > 0 && (
            <div className="bg-card border rounded-xl p-4">
              <h3 className="text-sm font-medium mb-4">Rounds by Type</h3>
              <div className="px-5 py-4 grid grid-cols-2 gap-3">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={roundsByType}
                      dataKey="value"
                      nameKey="name"
                      cx="50%" cy="50%"
                      outerRadius={85}
                      label={({ name, percent }) =>
                        percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : ''
                      }
                      labelLine={false}
                    >
                      {roundsByType.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} fillOpacity={0.8} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col justify-center gap-1.5">
                  {roundsByType.map((r, i) => (
                    <div key={r.name} className="flex items-center gap-2 text-xs">
                      <span
                        className="h-2.5 w-2.5 rounded-sm flex-shrink-0"
                        style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                      />
                      <span className="truncate text-muted-foreground">{r.name}</span>
                      <span className="ml-auto font-medium tabular-nums">{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════ DEALS TAB ══════════════════════ */}
      {activeTab === 'deals' && (
        <div className="flex flex-col gap-0">

          {/* Search + status filter */}
          <div className="flex items-center gap-3 px-6 py-3 border-b flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search company, investor, tag…"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1) }}
                className="w-full h-8 pl-8 pr-3 text-xs rounded-lg border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <MultiSelectDropdown
              label="Status"
              options={['pending', 'approved', 'rejected']}
              selected={selectedStatuses}
              onToggle={v => { toggleFilter(setSelectedStatuses, v); setPage(1) }}
              onClear={() => { setSelectedStatuses([]); setPage(1) }}
            />
            <span className="text-xs text-muted-foreground ml-auto">
              {filteredDeals.length} deal{filteredDeals.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  {([
                    ['company_name', 'Company'],
                    ['amount_usd',   'Amount'],
                  ] as const).map(([field, label]) => (
                    <th
                      key={field}
                      className={`px-4 py-2.5 text-left text-xs font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground ${
                        field === 'company_name' ? 'sticky left-0 z-20 bg-muted/40' : ''
                      }`}
                      onClick={() => toggleSort(field)}
                    >
                      <span className="flex items-center gap-1">
                        {label}
                        {sortField === field
                          ? (sortDir === 'desc' ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)
                          : null}
                      </span>
                    </th>
                  ))}
                  {(['Round', 'Vertical', 'Country', 'Date', 'Status', 'Source'] as const).map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">{h}</th>
                  ))}
                  {isAdmin && <th className="px-4 py-2.5" />}
                </tr>
              </thead>
              <tbody>
                {pagedDeals.length === 0 ? (
                  <tr><td colSpan={isAdmin ? 9 : 8} className="px-4 py-12 text-center text-sm text-muted-foreground">No deals found</td></tr>
                ) : (
                  pagedDeals.map(d => (
                    <DealRow key={d.id} deal={d} onReview={setReviewDeal} isAdmin={isAdmin} />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-3 border-t">
              <span className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!loading && deals.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <BarChart3 className="h-10 w-10 opacity-30" />
          <p className="text-sm">No market deals yet.</p>
          <p className="text-xs">Data will appear here as deals are scraped and approved.</p>
        </div>
      )}

      {/* Modals */}
      {reviewDeal && (
        <ReviewModal
          deal={reviewDeal}
          onClose={() => setReviewDeal(null)}
          onUpdate={loadDeals}
          isAdmin={isAdmin}
        />
      )}
      {showScrapeReport && (
        <ScrapeReportModal
          orgId={organization?.id ?? ''}
          onClose={() => setShowScrapeReport(false)}
        />
      )}
    </div>
  )
}
