'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Scale, ExternalLink, AlertTriangle, X, SlidersHorizontal, Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import type { Regulation, Issuer } from '@/lib/regulacoes/types'

const ALL_TAGS = ['Crypto','Payments','Banking','Open Finance','AML','Credit','Capital Markets','ESG','Data & Privacy','FX'] as const
type Tag = typeof ALL_TAGS[number]

// Color per topic
const TAG_COLORS: Record<Tag, { dot: string; bg: string; text: string; border: string }> = {
  'Crypto':          { dot: 'bg-violet-500',  bg: 'bg-violet-500/8',  text: 'text-violet-600 dark:text-violet-400',  border: 'border-violet-500/30' },
  'Payments':        { dot: 'bg-emerald-500', bg: 'bg-emerald-500/8', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/30' },
  'Banking':         { dot: 'bg-blue-500',    bg: 'bg-blue-500/8',    text: 'text-blue-600 dark:text-blue-400',      border: 'border-blue-500/30' },
  'Open Finance':    { dot: 'bg-teal-500',    bg: 'bg-teal-500/8',    text: 'text-teal-600 dark:text-teal-400',      border: 'border-teal-500/30' },
  'AML':             { dot: 'bg-red-500',     bg: 'bg-red-500/8',     text: 'text-red-600 dark:text-red-400',        border: 'border-red-500/30' },
  'Credit':          { dot: 'bg-orange-500',  bg: 'bg-orange-500/8',  text: 'text-orange-600 dark:text-orange-400',  border: 'border-orange-500/30' },
  'Capital Markets': { dot: 'bg-indigo-500',  bg: 'bg-indigo-500/8',  text: 'text-indigo-600 dark:text-indigo-400',  border: 'border-indigo-500/30' },
  'ESG':             { dot: 'bg-lime-500',    bg: 'bg-lime-500/8',    text: 'text-lime-600 dark:text-lime-500',      border: 'border-lime-500/30' },
  'Data & Privacy':  { dot: 'bg-pink-500',    bg: 'bg-pink-500/8',    text: 'text-pink-600 dark:text-pink-400',      border: 'border-pink-500/30' },
  'FX':              { dot: 'bg-amber-500',   bg: 'bg-amber-500/8',   text: 'text-amber-600 dark:text-amber-400',    border: 'border-amber-500/30' },
}

const DEFAULT_COLOR = { dot: 'bg-slate-400', bg: 'bg-slate-500/8', text: 'text-slate-600 dark:text-slate-400', border: 'border-slate-500/30' }

function getRegColor(reg: Regulation) {
  const firstTag = reg.tags?.[0] as Tag | undefined
  return firstTag ? (TAG_COLORS[firstTag] ?? DEFAULT_COLOR) : DEFAULT_COLOR
}

// const ISSUER_STYLES: Record<Issuer, { badge: string; badgeText: string; label: string }> = {
//   CVM:   { badge: 'bg-blue-500/10',    badgeText: 'text-blue-600 dark:text-blue-400',       label: 'CVM'   },
//   BCB:   { badge: 'bg-emerald-500/10', badgeText: 'text-emerald-600 dark:text-emerald-400', label: 'BCB'   },
//   CMN:   { badge: 'bg-amber-500/10',   badgeText: 'text-amber-600 dark:text-amber-400',     label: 'CMN'   },
//   OTHER: { badge: 'bg-violet-500/10',  badgeText: 'text-violet-600 dark:text-violet-400',   label: 'Other' },
// }

const ORDER_CONFIG = [
  { key: 'firstOrder'  as const, label: '1st Order', sub: 'Direct compliance obligations',    accent: 'bg-red-400'   },
  { key: 'secondOrder' as const, label: '2nd Order', sub: 'Indirectly affected players',      accent: 'bg-amber-400' },
  { key: 'thirdOrder'  as const, label: '3rd Order', sub: 'Ecosystem & startup implications', accent: 'bg-blue-400'  },
]

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).replace(' ', '/')
}

// ─── Multiselect ──────────────────────────────────────────────────────────────
function MultiSelect({ label, options, selected, onChange }: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])
  const count = selected.length
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 h-8 px-3 rounded-md text-xs font-medium border border-white/20 bg-white/10 hover:bg-white/20 text-white transition-colors">
        <span>{label}</span>
        {count > 0 && <span className="flex items-center justify-center w-4 h-4 rounded-full bg-white text-[10px] font-bold" style={{ color: 'hsl(206 54% 13%)' }}>{count}</span>}
        <SlidersHorizontal className="h-3 w-3 opacity-70" />
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-52 rounded-lg border border-white/10 shadow-xl overflow-hidden" style={{ background: 'hsl(206 54% 10%)' }}>
          <div className="p-1.5 space-y-0.5 max-h-72 overflow-y-auto">
            {options.map(opt => (
              <button key={opt} onClick={() => toggle(opt)}
                className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-md text-xs text-white/80 hover:bg-white/10 hover:text-white transition-colors">
                <span>{opt}</span>
                {selected.includes(opt) && <Check className="h-3 w-3 text-white" />}
              </button>
            ))}
          </div>
          {count > 0 && (<>
            <div className="h-px bg-white/10" />
            <button onClick={() => { onChange([]); setOpen(false) }}
              className="w-full px-3 py-2 text-xs text-white/50 hover:text-white/80 text-center transition-colors">Clear all</button>
          </>)}
        </div>
      )}
    </div>
  )
}

// ─── Filter bar ───────────────────────────────────────────────────────────────
function FilterBar({ activeTags, onTagsChange, activeYears, onYearsChange, years, totalCount, filteredCount }: {
  activeTags: Tag[]; onTagsChange: (t: Tag[]) => void
  activeYears: string[]; onYearsChange: (y: string[]) => void
  years: string[]; totalCount: number; filteredCount: number
}) {
  const hasFilters = activeTags.length > 0 || activeYears.length > 0
  return (
    <div className="rounded-lg px-4 py-3 flex items-center justify-between gap-4 flex-wrap" style={{ background: 'hsl(206 54% 13%)' }}>
      <p className="text-xs text-white/50">Showing <span className="text-white font-medium">{filteredCount}</span> of {totalCount}</p>
      <div className="flex items-center gap-2">
        {hasFilters && (
          <button onClick={() => { onTagsChange([]); onYearsChange([]) }}
            className="flex items-center gap-1 h-8 px-2 rounded-md text-xs text-white/50 hover:text-white transition-colors">
            <X className="h-3 w-3" /> Clear
          </button>
        )}
        <MultiSelect label="Year" options={years} selected={activeYears} onChange={onYearsChange} />
        <MultiSelect label="Topic" options={[...ALL_TAGS]} selected={activeTags as string[]} onChange={v => onTagsChange(v as Tag[])} />
      </div>
    </div>
  )
}

// ─── Timeline with scrubber ───────────────────────────────────────────────────
function TimelineSkeleton() {
  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="flex gap-4 px-6 py-6 animate-pulse">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="min-w-[140px] border rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-muted" /><div className="h-3 bg-muted rounded w-16" /></div>
            <div className="h-3 bg-muted rounded w-24" />
            <div className="h-3 bg-muted rounded w-20" />
          </div>
        ))}
      </div>
      <div className="border-t px-6 py-3"><div className="h-1 bg-muted rounded-full" /></div>
    </div>
  )
}

function RegulationsTimeline({ regulations }: { regulations: Regulation[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const scrollRef   = useRef<HTMLDivElement>(null)
  const trackRef    = useRef<HTMLDivElement>(null)
  const isDragging  = useRef(false)
  const dragStart   = useRef({ x: 0, scrollLeft: 0 })
  const [thumbPct, setThumbPct] = useState(0)

  const syncThumb = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setThumbPct(max > 0 ? el.scrollLeft / max : 0)
  }, [])

  useEffect(() => {
    syncThumb()
    const el = scrollRef.current
    el?.addEventListener('scroll', syncThumb, { passive: true })
    return () => el?.removeEventListener('scroll', syncThumb)
  }, [syncThumb, regulations])

  // Scrubber drag
  const onThumbPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    isDragging.current = true
    dragStart.current  = { x: e.clientX, scrollLeft: scrollRef.current?.scrollLeft ?? 0 }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const onThumbPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return
    const track  = trackRef.current
    const scroll = scrollRef.current
    if (!track || !scroll) return
    const trackW  = track.clientWidth - 20 // subtract thumb width
    const dx      = e.clientX - dragStart.current.x
    const ratio   = dx / trackW
    const maxScroll = scroll.scrollWidth - scroll.clientWidth
    scroll.scrollLeft = Math.max(0, Math.min(maxScroll, dragStart.current.scrollLeft + ratio * maxScroll))
  }, [])

  const onThumbPointerUp = useCallback(() => { isDragging.current = false }, [])

  // Track click-to-jump
  const onTrackClick = useCallback((e: React.MouseEvent) => {
    const track  = trackRef.current
    const scroll = scrollRef.current
    if (!track || !scroll) return
    const rect   = track.getBoundingClientRect()
    const ratio  = (e.clientX - rect.left) / rect.width
    scroll.scrollLeft = ratio * (scroll.scrollWidth - scroll.clientWidth)
  }, [])

  const selected = regulations.find(r => r.id === selectedId) ?? null

  if (regulations.length === 0) {
    return <p className="text-sm text-muted-foreground py-10 text-center">No regulations match the selected filters.</p>
  }

  return (
    <div className="border rounded-xl overflow-hidden">
      {/* Cards strip */}
      <div
        ref={scrollRef}
        className="overflow-x-auto"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <div className="flex gap-3 px-5 pt-5 pb-4 min-w-max">
          {regulations.map(reg => {
            const c = getRegColor(reg)
            const isSelected = selectedId === reg.id
            const s = ISSUER_STYLES[reg.issuer]
            return (
              <button
                key={reg.id}
                onClick={() => setSelectedId(isSelected ? null : reg.id)}
                className={`flex flex-col gap-2 text-left rounded-lg border p-3 min-w-[148px] max-w-[148px] transition-all duration-150 ${
                  isSelected
                    ? `${c.bg} ${c.border} shadow-sm`
                    : 'bg-card hover:bg-muted/50 border-border'
                }`}
              >
                {/* Dot + date */}
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${c.dot}`} />
                  <span className="text-[10px] text-muted-foreground tabular-nums">{fmtDate(reg.date)}</span>
                </div>
                {/* Name */}
                <p className="text-xs font-medium leading-snug line-clamp-3">{reg.shortName}</p>
                {/* First tag */}
                {reg.tags?.[0] && (
                  <span className={`self-start text-[9px] font-medium px-1.5 py-0.5 rounded-full ${c.bg} ${c.text} mt-auto`}>
                    {reg.tags[0]}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Detail panel */}
      {selected && (() => {
        const c = getRegColor(selected)
        const s = ISSUER_STYLES[selected.issuer]
        return (
          <div className={`border-t px-5 py-4 space-y-3 ${c.bg}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={`${s.badge} ${s.badgeText} border-0 text-xs`}>{s.label}</Badge>
                  {selected.tags?.map(t => {
                    const tc = TAG_COLORS[t as Tag] ?? DEFAULT_COLOR
                    return <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded-full ${tc.bg} ${tc.text}`}>{t}</span>
                  })}
                </div>
                <p className="font-semibold text-sm">{selected.name}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(selected.date)}</p>
              </div>
              <button onClick={() => setSelectedId(null)} className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">{selected.description}</p>
            {selected.whatChanged && (
              <div className="bg-background/60 rounded-md px-3 py-2 text-xs">
                <span className="font-medium text-foreground">What changed: </span>
                <span className="text-muted-foreground">{selected.whatChanged}</span>
              </div>
            )}
            <a href={selected.officialUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline">
              <ExternalLink className="h-3 w-3" /> View official text
            </a>
          </div>
        )
      })()}

      {/* Scrubber */}
      <div className="border-t px-5 py-3 bg-muted/30">
        <div
          ref={trackRef}
          onClick={onTrackClick}
          className="relative h-1 bg-border rounded-full cursor-pointer"
        >
          {/* Progress fill */}
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-muted-foreground/30 transition-none"
            style={{ width: `calc(${thumbPct * 100}% + 20px)` }}
          />
          {/* Draggable thumb */}
          <div
            onPointerDown={onThumbPointerDown}
            onPointerMove={onThumbPointerMove}
            onPointerUp={onThumbPointerUp}
            onPointerCancel={onThumbPointerUp}
            style={{ left: `calc(${thumbPct * 100}% * (1 - 20px / 100%))`, transform: 'translateY(-50%) translateX(-50%)' , top: '50%', position: 'absolute' }}
            className="w-5 h-5 rounded-full border-2 border-foreground/30 bg-background shadow-sm cursor-grab active:cursor-grabbing hover:border-foreground/60 transition-colors touch-none"
          />
        </div>
      </div>
    </div>
  )
}

// ─── Latest cards ───────────────────────────────────────────────────────────
function LatestRegulationsCards({ regulations }: { regulations: Regulation[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
      {regulations.map(reg => {
        const s = ISSUER_STYLES[reg.issuer]
        return (
          <Card key={reg.id} className="flex flex-col h-full">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <Badge className={`${s.badge} ${s.badgeText} border-0 text-xs`}>{s.label}</Badge>
                <span className="text-xs text-muted-foreground">{fmtDate(reg.date)}</span>
              </div>
              <p className="font-semibold text-sm mt-2 leading-snug">{reg.name}</p>
              <div className="flex gap-1 flex-wrap mt-1.5">
                {reg.tags?.map(t => {
                  const tc = TAG_COLORS[t as Tag] ?? DEFAULT_COLOR
                  return <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded-full ${tc.bg} ${tc.text}`}>{t}</span>
                })}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col flex-1 gap-0 pt-0">
              <p className="text-sm text-muted-foreground flex-1">{reg.fullContext}</p>
              <div className="mt-4 bg-muted rounded-md px-3 py-2 text-xs">
                <span className="font-medium text-foreground">What changed: </span>
                <span className="text-muted-foreground">{reg.whatChanged}</span>
              </div>
              <a href={reg.officialUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 mt-3 hover:underline">
                <ExternalLink className="h-3 w-3" /> View official text
              </a>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

// ─── Impact analysis ─────────────────────────────────────────────────────────
function ImpactFilterSection({ regulations }: { regulations: Regulation[] }) {
  const [selectedId, setSelectedId] = useState(regulations[regulations.length - 1]?.id ?? '')
  const reg = regulations.find(r => r.id === selectedId)
  return (
    <div className="space-y-4">
      <Select value={selectedId} onValueChange={setSelectedId}>
        <SelectTrigger className="w-full md:w-80"><SelectValue placeholder="Select a regulation" /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>BCB</SelectLabel>
            {regulations.map(r => (
              <SelectItem key={r.id} value={r.id}>{r.shortName} – {r.date.slice(0,4)}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {reg && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {ORDER_CONFIG.map(order => (
            <div key={order.key} className="border rounded-lg overflow-hidden">
              <div className={`h-1 w-full ${order.accent}`} />
              <div className="p-4 space-y-3">
                <div>
                  <p className="font-semibold text-sm">{order.label}</p>
                  <p className="text-xs text-muted-foreground">{order.sub}</p>
                </div>
                <Separator />
                {reg.impacts[order.key].map((entry, i) => (
                  <div key={i} className="space-y-1">
                    <Badge variant="secondary" className="text-[10px] h-auto py-0.5">{entry.sectorOrType}</Badge>
                    <p className="text-xs text-muted-foreground">{entry.why}</p>
                    {i < reg.impacts[order.key].length - 1 && <Separator className="mt-2" />}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Root ───────────────────────────────────────────────────────────────────
export function RegulacoesBRClient() {
  const [regulations, setRegulations] = useState<Regulation[]>([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [activeTags, setActiveTags]   = useState<Tag[]>([])
  const [activeYears, setActiveYears] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/regulacoes')
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${r.status} — ${r.statusText}`)
        }
        return r.json()
      })
      .then((data: Regulation[]) => { setRegulations(data); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  const years = useMemo(() =>
    Array.from(new Set(regulations.map(r => r.date.slice(0, 4)))).sort()
  , [regulations])

  const filtered = useMemo(() =>
    regulations.filter(r => {
      if (activeTags.length  > 0 && !activeTags.some(t => r.tags?.includes(t)))    return false
      if (activeYears.length > 0 && !activeYears.includes(r.date.slice(0, 4))) return false
      return true
    })
  , [regulations, activeTags, activeYears])

  const latestFive = useMemo(
    () => [...filtered].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
    [filtered]
  )

  return (
    <div className="p-4 md:py-8 md:px-8 space-y-8">
      {/* Header + filter */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Scale className="h-5 w-5" /> Regulatory Timeline
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Banco Central do Brasil · 2017–2025</p>
        </div>
        {!loading && !error && (
          <FilterBar
            activeTags={activeTags}   onTagsChange={setActiveTags}
            activeYears={activeYears} onYearsChange={setActiveYears}
            years={years} totalCount={regulations.length} filteredCount={filtered.length}
          />
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-destructive">Failed to load regulations</p>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">{error}</p>
          </div>
        </div>
      )}

      <section>
        <h2 className="text-base font-semibold mb-4">Timeline</h2>
        {loading ? <TimelineSkeleton /> : <RegulationsTimeline regulations={filtered} />}
      </section>

      <section>
        <h2 className="text-base font-semibold mb-4">Latest 5 Regulations</h2>
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="animate-pulse border rounded-lg p-4 space-y-3">
                <div className="h-4 bg-muted rounded w-20" />
                <div className="h-4 bg-muted rounded w-40" />
                <div className="h-20 bg-muted rounded" />
              </div>
            ))}
          </div>
        ) : <LatestRegulationsCards regulations={latestFive} />}
      </section>

      <section>
        <h2 className="text-base font-semibold mb-1">Impact Analysis</h2>
        <p className="text-sm text-muted-foreground mb-4">Select a regulation to view first, second, and third-order implications.</p>
        {loading
          ? <div className="animate-pulse h-10 bg-muted rounded w-80" />
          : <ImpactFilterSection regulations={filtered} />}
      </section>
    </div>
  )
}
