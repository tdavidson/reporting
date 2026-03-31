'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts'
import {
  TrendingUp, Globe, DollarSign, Building2, BarChart3,
  Upload, RefreshCw, ExternalLink, X, FileSpreadsheet, Loader2,
  ChevronDown, ChevronUp, Search, Zap, Pencil, Trash2, Check, ChevronsUpDown, ClipboardList,
  Info,
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
import { ScrapeReviewModal } from './review-modal'

// ─── constants ───────────────────────────────────────────────────────────────

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

const STAGE_OPTIONS = [
  'Pre-Seed','Seed','Series A','Series B','Series C','Series D','Series E','Growth','Bridge',
]

const STAGE_COLORS: Record<string, string> = {
  'Pre-Seed': '#6366f1',
  'Seed':     '#8b5cf6',
  'Series A': '#3b82f6',
  'Series B': '#0ea5e9',
  'Series C': '#84cc16',
  'Series D': '#84cc16',
  'Series E': '#84cc16',
  'Growth':   '#84cc16',
  'Bridge':   '#f97316',
  'IPO':      '#f97316',
  'M&A':      '#f97316',
}

const PIE_COLORS = [
  '#6366f1','#8b5cf6','#3b82f6','#0ea5e9',
  '#14b8a6','#22c55e','#f59e0b','#f97316','#ef4444',
]

const SEGMENT_PALETTE = [
  '#6366f1','#3b82f6','#0ea5e9','#14b8a6',
  '#22c55e','#84cc16','#f59e0b','#f97316','#ef4444','#8b5cf6',
]

const COLOR_ROUNDS  = '#0F2332'
const COLOR_CAPITAL = '#22c55e'

const LABEL_STYLE_ROUNDS  = { fontSize: 13, fontWeight: 700, fill: COLOR_ROUNDS  }
const LABEL_STYLE_CAPITAL = { fontSize: 13, fontWeight: 700, fill: COLOR_CAPITAL }
const LABEL_STYLE_COUNTRY = { fontSize: 13, fontWeight: 700, fill: '#6366f1'     }

const BAR_ROW_H   = 36
const CHART_MIN_H = 160

// ─── Sources list (mirrors lib/vc-market/scrapers.ts SOURCES) ────────────────

const SCRAPE_SOURCES = [
  { name: 'Google News – LatAm Funding',   url: 'https://news.google.com/rss/search?q=startup+rodada+captacao+venture+capital+serie+latam&hl=pt-BR&gl=BR&ceid=BR:pt', type: 'RSS' },
  { name: 'Google News – Brazil Startups', url: 'https://news.google.com/rss/search?q=startup+brazil+funding+raised+series+venture&hl=en&gl=BR&ceid=BR:en', type: 'RSS' },
  { name: 'Google News – Mexico Startups', url: 'https://news.google.com/rss/search?q=startup+mexico+funding+raised+series+venture&hl=en&gl=MX&ceid=MX:en', type: 'RSS' },
  { name: 'Google News – Colombia Startups', url: 'https://news.google.com/rss/search?q=startup+colombia+funding+raised+series+venture&hl=en&gl=CO&ceid=CO:en', type: 'RSS' },
  { name: 'Google News – LATAM VC EN',     url: 'https://news.google.com/rss/search?q=latin+america+startup+funding+venture+capital+series&hl=en-US&gl=US&ceid=US:en', type: 'RSS' },
  { name: 'Pipeline Valor',                url: 'https://pipelinevalor.globo.com/negocios/', type: 'HTML' },
  { name: 'Brazil Journal – PE/VC',        url: 'https://braziljournal.com/hot-topic/private-equity-vc/', type: 'HTML' },
  { name: 'NeoFeed Startups',              url: 'https://neofeed.com.br/startups/', type: 'HTML' },
  { name: 'Finsiders Brasil',              url: 'https://finsidersbrasil.com.br/ultimas-noticias/', type: 'HTML' },
  { name: 'LATAM List – Funding',          url: 'https://latamlist.com/category/startup-news/funding/', type: 'HTML' },
  { name: 'Startups.com.br',               url: 'https://startups.com.br/ultimas-noticias/', type: 'HTML' },
  { name: 'Startupi',                      url: 'https://startupi.com.br/noticias/', type: 'HTML' },
  { name: 'LATAM Fintech',                 url: 'https://www.latamfintech.co/articles', type: 'HTML' },
]

// ─── helpers ─────────────────────────────────────────────────────────────────

function barProps(color: string) {
  return { fill: color, fillOpacity: 0.6, stroke: color, strokeWidth: 1.5 }
}

function formatUSD(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toLocaleString()}`
}

function getLatestDeals(deals: VCDeal[]): VCDeal[] {
  return [...deals]
    .sort((a, b) => (b.deal_date ?? '').localeCompare(a.deal_date ?? ''))
    .slice(0, 10)
}

function computeKPIs(deals: VCDeal[]): VCKPIs {
  const capital   = deals.reduce((s, d) => s + (d.amount_usd ?? 0), 0)
  const companies = new Set(deals.map(d => d.company_name.toLowerCase())).size
  const countries = new Set(deals.map(d => d.country).filter(Boolean)).size
  const withAmount = deals.filter(d => d.amount_usd)
  const avgTicket  = withAmount.length > 0
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
    .map(([country, capital]) => ({ country, capital }))
}

function segmentColor(seg: string | null | undefined, segmentIndex: Map<string, number>): string {
  const key = seg ?? 'Other'
  if (!segmentIndex.has(key)) segmentIndex.set(key, segmentIndex.size)
  return SEGMENT_PALETTE[segmentIndex.get(key)! % SEGMENT_PALETTE.length]
}

function buildTop10Deals(deals: VCDeal[]) {
  return [...deals]
    .filter(d => d.amount_usd)
    .sort((a, b) => (b.amount_usd ?? 0) - (a.amount_usd ?? 0))
    .slice(0, 10)
    .map(d => ({
      company: d.company_name,
      amount:  d.amount_usd ?? 0,
      segment: d.segment ?? 'Other',
      stage:   d.stage ?? '',
      country: d.country ?? '',
    }))
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

const labelFmtRounds = (v: unknown) => (v != null ? String(v) : '')
const labelFmtUSD    = (v: unknown) => (typeof v === 'number' && v ? formatUSD(v) : '')

function CompanyTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={10} textAnchor="end" transform="rotate(-35)"
        style={{ fontSize: 11, fill: 'var(--muted-foreground)' }}>
        {payload?.value ?? ''}
      </text>
    </g>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

// ─── SourcesModal ─────────────────────────────────────────────────────────────

function SourcesModal({ onClose }: { onClose: () => void }) {
  const rss  = SCRAPE_SOURCES.filter(s => s.type === 'RSS')
  const html = SCRAPE_SOURCES.filter(s => s.type === 'HTML')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background border rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div>
            <h2 className="text-sm font-semibold">AI Scrape Sources</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {SCRAPE_SOURCES.length} sources monitored daily for LATAM VC deals
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 space-y-5">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              RSS Feeds ({rss.length})
            </p>
            <div className="space-y-1.5">
              {rss.map(s => (
                <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border bg-muted/30 hover:bg-muted/60 transition-colors group">
                  <span className="text-xs font-medium truncate">{s.name}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
                </a>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              HTML Sources ({html.length})
            </p>
            <div className="space-y-1.5">
              {html.map(s => (
                <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border bg-muted/30 hover:bg-muted/60 transition-colors group">
                  <span className="text-xs font-medium truncate">{s.name}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
                </a>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground border-t pt-3">
            Articles from the last 48 h are processed by Claude AI, which extracts only confirmed LATAM funding rounds and filters out debt, grants, and non-LATAM companies.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── MultiSelect ─────────────────────────────────────────────────────────────

function MultiSelect({ options, selected, onChange, placeholder }: {
  options: string[]; selected: string[]; onChange: (v: string[]) => void; placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v])

  const label = selected.length === 0 ? placeholder
    : selected.length === 1 ? selected[0]
    : `${selected.length} selected`

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`h-8 min-w-[120px] max-w-[160px] flex items-center justify-between gap-1 px-3 rounded-md border bg-background text-xs transition-colors hover:bg-accent ${
          selected.length > 0 ? 'border-primary/60 text-foreground' : 'text-muted-foreground'
        }`}>
        <span className="truncate">{label}</span>
        <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 min-w-[160px] max-h-56 overflow-y-auto bg-popover border rounded-md shadow-md py-1">
          {options.map(opt => (
            <button key={opt} type="button" onClick={() => toggle(opt)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent text-left">
              <span className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 ${
                selected.includes(opt) ? 'bg-primary border-primary' : 'border-border'
              }`}>
                {selected.includes(opt) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
              </span>
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── DragScroll ───────────────────────────────────────────────────────────────

function DragScroll({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref      = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const startX   = useRef(0)
  const scrollLeft = useRef(0)

  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current   = true
    startX.current     = e.pageX - (ref.current?.offsetLeft ?? 0)
    scrollLeft.current = ref.current?.scrollLeft ?? 0
    if (ref.current) ref.current.style.cursor = 'grabbing'
  }
  const onMouseUp = () => {
    dragging.current = false
    if (ref.current) ref.current.style.cursor = 'grab'
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current || !ref.current) return
    e.preventDefault()
    ref.current.scrollLeft = scrollLeft.current - (e.pageX - ref.current.offsetLeft - startX.current)
  }

  return (
    <div ref={ref} onMouseDown={onMouseDown} onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp} onMouseMove={onMouseMove}
      className={className} style={{ cursor: 'grab', overflowX: 'auto', scrollbarWidth: 'none' }}>
      {children}
    </div>
  )
}

// ─── EditDealModal ────────────────────────────────────────────────────────────

function EditDealModal({ deal, onClose, onSaved, onDeleted }: {
  deal: VCDeal; onClose: () => void; onSaved: (u: VCDeal) => void; onDeleted: (id: string) => void
}) {
  const [form, setForm] = useState({
    company_name: deal.company_name,
    amount_usd:   deal.amount_usd?.toString() ?? '',
    deal_date:    deal.deal_date ?? '',
    stage:        deal.stage ?? '',
    investors:    deal.investors?.join(', ') ?? '',
    segment:      deal.segment ?? '',
    country:      deal.country ?? '',
    source_url:   deal.source_url ?? '',
  })
  const [saving,     setSaving]     = useState(false)
  const [deleting,   setDeleting]   = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = {
        company_name: form.company_name.trim(),
        amount_usd:   form.amount_usd ? parseFloat(form.amount_usd) : null,
        deal_date:    form.deal_date || null,
        stage:        form.stage || null,
        investors:    form.investors ? form.investors.split(',').map(s => s.trim()).filter(Boolean) : [],
        segment:      form.segment || null,
        country:      form.country || null,
        source_url:   form.source_url || null,
      }
      const res  = await fetch(`/api/vc-market/deals/${deal.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Save failed')
      toast.success('Deal updated')
      onSaved(data.deal)
      onClose()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Save failed') }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/vc-market/deals/${deal.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      toast.success('Deal deleted')
      onDeleted(deal.id)
      onClose()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Delete failed') }
    finally { setDeleting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background border rounded-xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-sm font-semibold">Edit Deal</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 grid grid-cols-2 gap-3">
          <Field label="Company"><Input value={form.company_name} onChange={e => set('company_name', e.target.value)} className="h-8 text-xs" /></Field>
          <Field label="Amount (USD)"><Input value={form.amount_usd} onChange={e => set('amount_usd', e.target.value)} placeholder="5000000" className="h-8 text-xs" /></Field>
          <Field label="Date"><Input type="date" value={form.deal_date} onChange={e => set('deal_date', e.target.value)} className="h-8 text-xs" /></Field>
          <Field label="Stage">
            <select value={form.stage} onChange={e => set('stage', e.target.value)} className="h-8 rounded-md border bg-background text-xs px-2">
              <option value="">— none —</option>
              {STAGE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Country"><Input value={form.country} onChange={e => set('country', e.target.value)} placeholder="BR" className="h-8 text-xs" /></Field>
          <Field label="Segment"><Input value={form.segment} onChange={e => set('segment', e.target.value)} placeholder="Fintech" className="h-8 text-xs" /></Field>
          <Field label="Investors (comma-separated)"><Input value={form.investors} onChange={e => set('investors', e.target.value)} placeholder="Sequoia, a16z" className="h-8 text-xs" /></Field>
          <Field label="Source URL"><Input value={form.source_url} onChange={e => set('source_url', e.target.value)} placeholder="https://..." className="h-8 text-xs" /></Field>
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t">
          {confirmDel ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-destructive">Confirm delete?</span>
              <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={handleDelete} disabled={deleting}>
                {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Yes, delete'}
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setConfirmDel(false)}>Cancel</Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => setConfirmDel(true)}>
              <Trash2 className="h-3 w-3 mr-1" />Delete
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onClose}>Cancel</Button>
            <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── ImportModal ──────────────────────────────────────────────────────────────

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
      const res  = await fetch('/api/vc-market/import', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Import failed')
      toast.success(`Imported ${data.inserted} deals${data.skipped > 0 ? ` (${data.skipped} skipped)` : ''}`)
      if (data.errors?.length) toast.error(`${data.errors.length} row error(s) — check format`)
      onSuccess()
      onClose()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Import failed') }
    finally { setLoading(false) }
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
          Upload an <code>.xlsx</code> or <code>.csv</code> file.
          Columns: <strong>Company Name, Amount USD, Date, Stage, Investors, Segment, Country, Source URL</strong>.
        </p>
        <div onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors mb-4 ${
            file ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
          }`}>
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

// ─── KPICard ──────────────────────────────────────────────────────────────────

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

// ─── DealRow ──────────────────────────────────────────────────────────────────

function DealRow({ deal, onEdit }: { deal: VCDeal; onEdit: (d: VCDeal) => void }) {
  const stageColor = deal.stage ? STAGE_COLORS[deal.stage] ?? '#94a3b8' : '#94a3b8'
  return (
    <tr className="border-b last:border-0 hover:bg-muted/30 transition-colors group">
      <td className="px-4 py-3 font-medium text-sm sticky left-0 z-10 bg-card group-hover:bg-muted/30 transition-colors whitespace-nowrap">
        {deal.company_name}
      </td>
      <td className="px-4 py-3 text-sm tabular-nums whitespace-nowrap">
        {deal.amount_usd ? formatUSD(deal.amount_usd) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
        {deal.deal_date ? new Date(deal.deal_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        {deal.stage
          ? <span className="text-xs font-medium px-2 py-0.5 rounded-full text-white whitespace-nowrap" style={{ backgroundColor: stageColor }}>{deal.stage}</span>
          : <span className="text-muted-foreground text-sm">—</span>}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground max-w-[180px] truncate">
        {deal.investors?.length > 0 ? deal.investors.join(', ') : '—'}
      </td>
      <td className="px-4 py-3 text-sm">
        {deal.segment ? <Badge variant="secondary" className="text-xs whitespace-nowrap">{deal.segment}</Badge> : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">{deal.country ?? '—'}</td>
      <td className="px-4 py-3">
        {deal.source_url
          ? <a href={deal.source_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1 text-xs whitespace-nowrap">
              Link <ExternalLink className="h-3 w-3" />
            </a>
          : <span className="text-muted-foreground text-sm">—</span>}
      </td>
      <td className="px-3 py-3">
        <button onClick={() => onEdit(deal)}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground">
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  )
}

// ─── Top10 tooltip ────────────────────────────────────────────────────────────

function Top10Tooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { company: string; amount: number; segment: string; stage: string; country: string } }> }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-popover border rounded-lg shadow-lg px-3 py-2 text-xs space-y-0.5">
      <p className="font-semibold text-foreground">{d.company}</p>
      <p className="text-emerald-500 font-bold">{formatUSD(d.amount)}</p>
      {d.segment && <p className="text-muted-foreground">{d.segment}</p>}
      {d.stage   && <p className="text-muted-foreground">{d.stage}</p>}
      {d.country && <p className="text-muted-foreground">{d.country}</p>}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Props { isAdmin: boolean }

export function VCMarketClient({ isAdmin }: Props) {
  const [deals, setDeals]               = useState<VCDeal[]>([])
  const [loading, setLoading]           = useState(true)
  const [scraping, setScraping]         = useState(false)
  const [showImport, setShowImport]     = useState(false)
  const [showReview, setShowReview]     = useState(false)
  const [showSources, setShowSources]   = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [editingDeal, setEditingDeal]   = useState<VCDeal | null>(null)
  const [search, setSearch]             = useState('')
  const [sortKey, setSortKey]           = useState<keyof VCDeal>('deal_date')
  const [sortDir, setSortDir]           = useState<'asc' | 'desc'>('desc')
  const [page, setPage]                 = useState(1)
  const PAGE_SIZE = 50

  const [filters, setFilters] = useState<VCFilters>({
    period: 'ytd', countries: [], segments: [], stages: [], investors: [],
  })
  const [allDeals, setAllDeals] = useState<VCDeal[]>([])

  const fetchDeals = useCallback(async (f: VCFilters) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('period', f.period)
      f.countries.forEach(v => params.append('country', v))
      f.segments.forEach(v  => params.append('segment', v))
      f.stages.forEach(v    => params.append('stage', v))
      f.investors.forEach(v => params.append('investor', v))
      const res  = await fetch(`/api/vc-market/deals?${params}`)
      const data = await res.json()
      setDeals(data.deals ?? [])
    } finally { setLoading(false) }
  }, [])

  const fetchAllDeals = useCallback(async () => {
    const res  = await fetch('/api/vc-market/deals?period=all')
    const data = await res.json()
    setAllDeals(data.deals ?? [])
  }, [])

  const fetchPendingCount = useCallback(async () => {
    const res  = await fetch('/api/vc-market/pending')
    const data = await res.json()
    setPendingCount((data.deals ?? []).length)
  }, [])

  useEffect(() => { fetchDeals(filters) },    [fetchDeals, filters])
  useEffect(() => { fetchAllDeals() },        [fetchAllDeals])
  useEffect(() => { fetchPendingCount() },    [fetchPendingCount])

  const hasActiveFilters = (
    filters.countries.length > 0 ||
    filters.segments.length  > 0 ||
    filters.stages.length    > 0 ||
    filters.investors.length > 0
  )

  const clearFilters = () => setFilters(f => ({ ...f, countries: [], segments: [], stages: [], investors: [] }))

  const handleScrape = async () => {
    setScraping(true)
    try {
      const res  = await fetch('/api/vc-market/scrape', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Scrape failed')
      const n = data.pending ?? 0
      if (n > 0) {
        toast.success(`${n} new deals ready for review`)
        setPendingCount(prev => prev + n)
        setShowReview(true)
      } else {
        toast.info('No new deals found')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Scrape failed')
    } finally { setScraping(false) }
  }

  const handleDealSaved   = (u: VCDeal)  => { setDeals(p => p.map(d => d.id === u.id ? u : d)); setAllDeals(p => p.map(d => d.id === u.id ? u : d)) }
  const handleDealDeleted = (id: string) => { setDeals(p => p.filter(d => d.id !== id));         setAllDeals(p => p.filter(d => d.id !== id)) }

  const kpis             = computeKPIs(deals)
  const latestDeals      = getLatestDeals(deals)
  const roundsByMonth    = buildRoundsByMonth(deals)
  const capitalByMonth   = buildCapitalByMonth(deals)
  const capitalBySegment = buildCapitalBySegment(deals)
  const roundsByVertical = buildRoundsByVertical(deals)
  const dealsByCountry   = buildDealsByCountry(deals)
  const capitalByCountry = buildCapitalByCountry(deals)
  const top10Deals       = buildTop10Deals(deals)

  const segIdx = new Map<string, number>()
  top10Deals.forEach(d => segmentColor(d.segment, segIdx))
  const top10Segments = Array.from(segIdx.entries()).map(([seg, idx]) => ({
    seg, color: SEGMENT_PALETTE[idx % SEGMENT_PALETTE.length],
  }))

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
      (d.country  ?? '').toLowerCase().includes(q) ||
      (d.stage    ?? '').toLowerCase().includes(q) ||
      d.investors.some(i => i.toLowerCase().includes(q))
    )
  })

  const sorted     = [...filtered].sort((a, b) => {
    const av = a[sortKey] ?? ''
    const bv = b[sortKey] ?? ''
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const paged      = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const SortIcon = ({ col }: { col: keyof VCDeal }) => {
    if (sortKey !== col) return null
    return sortDir === 'asc' ? <ChevronUp className="h-3 w-3 inline ml-0.5" /> : <ChevronDown className="h-3 w-3 inline ml-0.5" />
  }

  const emptyChart = (msg: string) => (
    <div className="h-[160px] flex items-center justify-center text-muted-foreground text-sm">{msg}</div>
  )

  const horzH = (n: number) => Math.max(CHART_MIN_H, n * BAR_ROW_H + 40)

  return (
    <div className="p-4 md:py-8 md:px-8 space-y-6 max-w-[1600px]">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">VC Market</h1>
            <p className="text-sm text-muted-foreground">Global venture capital deal flow — scraped daily & importable</p>
          </div>
          <button
            onClick={() => setShowSources(true)}
            className="mt-1 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="View AI scrape sources"
          >
            <Info className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Pending review badge */}
          {pendingCount > 0 && (
            <Button variant="outline" size="sm" onClick={() => setShowReview(true)}
              className="gap-1.5 border-amber-400/60 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30">
              <ClipboardList className="h-4 w-4" />
              Review deals
              <span className="ml-0.5 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                {pendingCount}
              </span>
            </Button>
          )}
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
        <Select value={filters.period} onValueChange={v => setFilters(f => ({ ...f, period: v }))}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Period" /></SelectTrigger>
          <SelectContent>{PERIOD_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
        <MultiSelect options={countryOptions}  selected={filters.countries} onChange={v => { setFilters(f => ({ ...f, countries: v })); setPage(1) }} placeholder="Country" />
        <MultiSelect options={segmentOptions}  selected={filters.segments}  onChange={v => { setFilters(f => ({ ...f, segments: v }));  setPage(1) }} placeholder="Segment" />
        <MultiSelect options={stageOptions}    selected={filters.stages}    onChange={v => { setFilters(f => ({ ...f, stages: v }));    setPage(1) }} placeholder="Stage" />
        <MultiSelect options={investorOptions} selected={filters.investors} onChange={v => { setFilters(f => ({ ...f, investors: v })); setPage(1) }} placeholder="Investor" />
        {hasActiveFilters && (
          <button onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KPICard label="Total Rounds"     value={kpis.totalRounds.toLocaleString()}                         icon={BarChart3}  color="bg-indigo-500/10 text-indigo-500" />
        <KPICard label="Total Capital"    value={kpis.totalCapital > 0 ? formatUSD(kpis.totalCapital) : '—'} icon={DollarSign} color="bg-emerald-500/10 text-emerald-500" />
        <KPICard label="Unique Companies" value={kpis.uniqueCompanies.toLocaleString()}                     icon={Building2}  color="bg-blue-500/10 text-blue-500" />
        <KPICard label="Avg Ticket"       value={kpis.avgTicket > 0 ? formatUSD(kpis.avgTicket) : '—'}      icon={TrendingUp} color="bg-violet-500/10 text-violet-500" />
        <KPICard label="Active Countries" value={kpis.activeCountries.toLocaleString()}                     icon={Globe}      color="bg-amber-500/10 text-amber-500" />
      </div>

      {/* Latest Deals */}
      {latestDeals.length > 0 && (
        <DragScroll className="bg-card border rounded-xl px-4 py-2.5 flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <span className="text-xs font-medium text-muted-foreground shrink-0 mr-1">Latest</span>
          {latestDeals.map((deal, i) => {
            const stageColor = deal.stage ? STAGE_COLORS[deal.stage] ?? '#94a3b8' : '#94a3b8'
            const chip = (
              <div key={deal.id} className="w-[160px] shrink-0 flex flex-col gap-1 px-3 py-2 rounded-lg border bg-muted/40">
                <div className="flex items-center justify-between gap-1 min-w-0">
                  {deal.source_url ? (
                    <a href={deal.source_url} target="_blank" rel="noopener noreferrer"
                      className="text-xs font-semibold leading-none truncate hover:text-primary transition-colors inline-flex items-center gap-0.5 group min-w-0"
                      onMouseDown={e => e.stopPropagation()}>
                      <span className="truncate">{deal.company_name}</span>
                      <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity" />
                    </a>
                  ) : (
                    <span className="text-xs font-semibold leading-none truncate min-w-0">{deal.company_name}</span>
                  )}
                  <span className="text-sm font-bold tabular-nums leading-none shrink-0" style={{ color: '#22c55e' }}>
                    {deal.amount_usd ? formatUSD(deal.amount_usd) : '—'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {deal.stage && (
                    <span className="text-[10px] font-medium px-1.5 py-px rounded-full text-white leading-none shrink-0" style={{ backgroundColor: stageColor }}>{deal.stage}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {deal.deal_date ? new Date(deal.deal_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                  </span>
                </div>
              </div>
            )
            return i < latestDeals.length - 1
              ? [chip, <span key={`sep-${i}`} className="text-border/60 shrink-0">·</span>]
              : chip
          })}
        </DragScroll>
      )}

      {/* Charts */}
      {!loading && deals.length > 0 && (
        <div className="space-y-4">
          {top10Deals.length > 0 && (
            <div className="bg-card border rounded-xl p-4">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-medium">Top 10 Deals by Capital</h3>
                {top10Segments.length > 0 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 justify-end">
                    {top10Segments.map(({ seg, color }) => (
                      <span key={seg} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />{seg}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={top10Deals} margin={{ top: 28, right: 16, bottom: 60, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="company" tick={<CompanyTick />} interval={0} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtUSDAxis} width={56} />
                  <Tooltip content={<Top10Tooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                  <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={64}>
                    {top10Deals.map((d, i) => { const c = segmentColor(d.segment, new Map(segIdx)); return <Cell key={i} fill={c} fillOpacity={0.75} stroke={c} strokeWidth={1.5} /> })}
                    <LabelList dataKey="amount" position="top" formatter={labelFmtUSD} style={{ fontSize: 11, fontWeight: 700, fill: 'hsl(var(--muted-foreground))' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-card border rounded-xl p-4">
              <h3 className="text-sm font-medium mb-4">Rounds by Month</h3>
              {roundsByMonth.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={roundsByMonth} margin={{ top: 20, right: 8, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} interval={0} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={fmtRounds} />
                    <Bar dataKey="rounds" {...barProps(COLOR_ROUNDS)} radius={[3, 3, 0, 0]}>
                      <LabelList dataKey="rounds" position="top" formatter={labelFmtRounds} style={LABEL_STYLE_ROUNDS} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : emptyChart('No dated deals in period')}
            </div>

            <div className="bg-card border rounded-xl p-4">
              <h3 className="text-sm font-medium mb-4">Capital by Month (USD)</h3>
              {capitalByMonth.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={capitalByMonth} margin={{ top: 20, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} interval={0} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtUSDAxis} width={56} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={fmtCapital} />
                    <Bar dataKey="capital" {...barProps(COLOR_CAPITAL)} radius={[3, 3, 0, 0]}>
                      <LabelList dataKey="capital" position="top" formatter={labelFmtUSD} style={LABEL_STYLE_CAPITAL} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : emptyChart('No capital data in period')}
            </div>

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

            <div className="bg-card border rounded-xl p-4">
              <h3 className="text-sm font-medium mb-4">Deals by Country</h3>
              {dealsByCountry.length > 0 ? (
                <ResponsiveContainer width="100%" height={horzH(dealsByCountry.length)}>
                  <BarChart data={dealsByCountry} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis dataKey="country" type="category" tick={{ fontSize: 11 }} width={38} />
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

            <div className="bg-card border rounded-xl p-4">
              <h3 className="text-sm font-medium mb-4">Capital by Country (USD)</h3>
              {capitalByCountry.length > 0 ? (
                <ResponsiveContainer width="100%" height={horzH(capitalByCountry.length)}>
                  <BarChart data={capitalByCountry} layout="vertical" margin={{ top: 0, right: 60, bottom: 0, left: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmtUSDAxis} />
                    <YAxis dataKey="country" type="category" tick={{ fontSize: 11 }} width={38} />
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
            <Button size="sm" onClick={() => setShowImport(true)}><Upload className="h-4 w-4 mr-1" /> Import Excel</Button>
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
                    [null,           ''],
                  ] as [keyof VCDeal | null, string][]).map(([key, label], colIdx) => (
                    <th key={label}
                      className={`px-4 py-2.5 text-left font-medium whitespace-nowrap ${
                        colIdx === 0 ? 'sticky left-0 z-10 bg-muted/30' : ''
                      } ${ key ? 'cursor-pointer select-none hover:text-foreground' : '' }`}
                      onClick={() => key && toggleSort(key)}>
                      {label}{key && <SortIcon col={key} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.length === 0
                  ? <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-sm">No deals match your search</td></tr>
                  : paged.map(deal => <DealRow key={deal.id} deal={deal} onEdit={setEditingDeal} />)}
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

      {showImport && <ImportModal onClose={() => setShowImport(false)} onSuccess={() => { fetchDeals(filters); fetchAllDeals() }} />}

      {showReview && (
        <ScrapeReviewModal
          onClose={() => { setShowReview(false); fetchPendingCount() }}
          onPublished={() => { fetchDeals(filters); fetchAllDeals(); setPendingCount(0) }}
        />
      )}

      {showSources && <SourcesModal onClose={() => setShowSources(false)} />}

      {editingDeal && (
        <EditDealModal
          deal={editingDeal}
          onClose={() => setEditingDeal(null)}
          onSaved={handleDealSaved}
          onDeleted={handleDealDeleted}
        />
      )}
    </div>
  )
}
