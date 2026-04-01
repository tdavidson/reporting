'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Scale, ExternalLink, AlertTriangle, ChevronLeft, ChevronRight, X, SlidersHorizontal, Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import type { Regulation, Issuer } from '@/lib/regulacoes/types'

const ALL_TAGS = ['Crypto','Payments','Banking','Open Finance','AML','Credit','Capital Markets','ESG','Data & Privacy','FX'] as const
type Tag = typeof ALL_TAGS[number]

const ISSUER_STYLES: Record<Issuer, { dot: string; badge: string; badgeText: string; label: string }> = {
  CVM:   { dot: 'bg-blue-400',    badge: 'bg-blue-500/10',    badgeText: 'text-blue-600 dark:text-blue-400',       label: 'CVM'   },
  BCB:   { dot: 'bg-emerald-400', badge: 'bg-emerald-500/10', badgeText: 'text-emerald-600 dark:text-emerald-400', label: 'BCB'   },
  CMN:   { dot: 'bg-amber-400',   badge: 'bg-amber-500/10',   badgeText: 'text-amber-600 dark:text-amber-400',     label: 'CMN'   },
  OTHER: { dot: 'bg-violet-400',  badge: 'bg-violet-500/10',  badgeText: 'text-violet-600 dark:text-violet-400',   label: 'Other' },
}

const ORDER_CONFIG = [
  { key: 'firstOrder'  as const, label: '1st Order', sub: 'Direct compliance obligations',    accent: 'bg-red-400'   },
  { key: 'secondOrder' as const, label: '2nd Order', sub: 'Indirectly affected players',      accent: 'bg-amber-400' },
  { key: 'thirdOrder'  as const, label: '3rd Order', sub: 'Ecosystem & startup implications', accent: 'bg-blue-400'  },
]

// ─── Multiselect dropdown ───────────────────────────────────────────────────
function MultiSelect({
  label, options, selected, onChange,
}: {
  label: string
  options: string[]
  selected: string[]
  onChange: (v: string[]) => void
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
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])

  const count = selected.length

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 h-8 px-3 rounded-md text-xs font-medium border border-white/20 bg-white/10 hover:bg-white/20 text-white transition-colors"
      >
        <span>{label}</span>
        {count > 0 && (
          <span className="flex items-center justify-center w-4 h-4 rounded-full bg-white text-[10px] font-bold" style={{ color: 'hsl(206 54% 13%)' }}>
            {count}
          </span>
        )}
        <SlidersHorizontal className="h-3 w-3 opacity-70" />
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-52 rounded-lg border border-white/10 shadow-xl overflow-hidden" style={{ background: 'hsl(206 54% 10%)' }}>
          <div className="p-1.5 space-y-0.5 max-h-72 overflow-y-auto">
            {options.map(opt => {
              const active = selected.includes(opt)
              return (
                <button
                  key={opt}
                  onClick={() => toggle(opt)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-md text-xs text-white/80 hover:bg-white/10 hover:text-white transition-colors"
                >
                  <span>{opt}</span>
                  {active && <Check className="h-3 w-3 text-white" />}
                </button>
              )
            })}
          </div>
          {count > 0 && (
            <>
              <div className="h-px bg-white/10" />
              <button
                onClick={() => { onChange([]); setOpen(false) }}
                className="w-full px-3 py-2 text-xs text-white/50 hover:text-white/80 text-center transition-colors"
              >Clear all</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Filter bar (navy brand color) ─────────────────────────────────────────
function FilterBar({
  activeTags, onTagsChange,
  activeYears, onYearsChange,
  years, totalCount, filteredCount,
}: {
  activeTags: Tag[]; onTagsChange: (t: Tag[]) => void
  activeYears: string[]; onYearsChange: (y: string[]) => void
  years: string[]; totalCount: number; filteredCount: number
}) {
  const hasFilters = activeTags.length > 0 || activeYears.length > 0
  return (
    <div
      className="rounded-lg px-4 py-3 flex items-center justify-between gap-4 flex-wrap"
      style={{ background: 'hsl(206 54% 13%)' }}
    >
      <p className="text-xs text-white/50">
        Showing <span className="text-white font-medium">{filteredCount}</span> of {totalCount} regulations
      </p>
      <div className="flex items-center gap-2">
        {hasFilters && (
          <button
            onClick={() => { onTagsChange([]); onYearsChange([]) }}
            className="flex items-center gap-1 h-8 px-2 rounded-md text-xs text-white/50 hover:text-white transition-colors"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
        <MultiSelect
          label="Year"
          options={years}
          selected={activeYears}
          onChange={onYearsChange as (v: string[]) => void}
        />
        <MultiSelect
          label="Topic"
          options={[...ALL_TAGS]}
          selected={activeTags as string[]}
          onChange={v => onTagsChange(v as Tag[])}
        />
      </div>
    </div>
  )
}

// ─── Horizontal scroll timeline ────────────────────────────────────────────
function TimelineSkeleton() {
  return (
    <div className="relative border rounded-xl overflow-hidden py-8 px-6">
      <div className="flex gap-10 animate-pulse">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2 min-w-[100px]">
            <div className="h-3 bg-muted rounded w-16" />
            <div className="w-3 h-3 rounded-full bg-muted" />
            <div className="h-3 bg-muted rounded w-12" />
          </div>
        ))}
      </div>
    </div>
  )
}

function RegulationsTimeline({ regulations }: { regulations: Regulation[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft]   = useState(false)
  const [canRight, setCanRight] = useState(false)

  const checkScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4)
  }, [])

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    el?.addEventListener('scroll', checkScroll, { passive: true })
    return () => el?.removeEventListener('scroll', checkScroll)
  }, [checkScroll, regulations])

  const scroll = (dir: 'left' | 'right') => {
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -320 : 320, behavior: 'smooth' })
  }

  const selected = regulations.find(r => r.id === selectedId) ?? null

  if (regulations.length === 0) {
    return <p className="text-sm text-muted-foreground py-10 text-center">No regulations match the selected filters.</p>
  }

  return (
    <div className="space-y-0">
      {/* Scroll strip */}
      <div className="relative border rounded-xl overflow-hidden">
        {/* Left arrow */}
        {canLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute left-0 top-0 bottom-0 z-10 w-12 flex items-center justify-start pl-2 bg-gradient-to-r from-background to-transparent"
          >
            <span className="flex items-center justify-center w-7 h-7 rounded-full border bg-background shadow-sm hover:bg-muted transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </span>
          </button>
        )}
        {/* Right arrow */}
        {canRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-0 top-0 bottom-0 z-10 w-12 flex items-center justify-end pr-2 bg-gradient-to-l from-background to-transparent"
          >
            <span className="flex items-center justify-center w-7 h-7 rounded-full border bg-background shadow-sm hover:bg-muted transition-colors">
              <ChevronRight className="h-4 w-4" />
            </span>
          </button>
        )}

        {/* Scrollable area */}
        <div
          ref={scrollRef}
          className="overflow-x-auto scrollbar-hide"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          <div className="relative flex items-end px-8 pt-8 pb-6 gap-0 min-w-max">
            {/* Baseline */}
            <div className="absolute bottom-[38px] left-0 right-0 h-px bg-border" />

            {regulations.map((reg, i) => {
              const s = ISSUER_STYLES[reg.issuer]
              const isSelected = selectedId === reg.id
              const year = reg.date.slice(0, 4)
              const month = new Date(reg.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })
              const showYear = i === 0 || year !== regulations[i - 1].date.slice(0, 4)

              return (
                <div key={reg.id} className="flex flex-col items-center" style={{ minWidth: 110 }}>
                  {/* Label above */}
                  <span className="text-[10px] text-muted-foreground text-center leading-tight mb-2 px-1 max-w-[100px] line-clamp-2">
                    {reg.shortName}
                  </span>

                  {/* Dot */}
                  <button
                    onClick={() => setSelectedId(isSelected ? null : reg.id)}
                    title={reg.name}
                    className={`relative z-10 transition-all duration-150 rounded-full ${
                      isSelected
                        ? `w-3.5 h-3.5 ring-2 ring-offset-2 ring-offset-background ${s.dot} ${s.dot.replace('bg-','ring-')}`
                        : `w-2.5 h-2.5 hover:scale-125 ${s.dot}`
                    }`}
                  />

                  {/* Year/month below */}
                  <div className="mt-2 text-center">
                    {showYear && (
                      <span className="block text-[10px] font-semibold text-foreground tabular-nums">{year}</span>
                    )}
                    <span className="block text-[10px] text-muted-foreground tabular-nums">{month}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="border border-t-0 rounded-b-xl bg-muted/20 px-5 py-4 space-y-3 -mt-px">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={`${ISSUER_STYLES[selected.issuer].badge} ${ISSUER_STYLES[selected.issuer].badgeText} border-0 text-xs`}>
                  {ISSUER_STYLES[selected.issuer].label}
                </Badge>
                {selected.tags?.map(t => (
                  <span key={t} className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{t}</span>
                ))}
              </div>
              <p className="font-semibold text-sm">{selected.name}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(selected.date + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
            <button onClick={() => setSelectedId(null)} className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-sm text-muted-foreground">{selected.description}</p>
          {selected.whatChanged && (
            <div className="bg-muted rounded-md px-3 py-2 text-xs">
              <span className="font-medium text-foreground">What changed: </span>
              <span className="text-muted-foreground">{selected.whatChanged}</span>
            </div>
          )}
          <a href={selected.officialUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline">
            <ExternalLink className="h-3 w-3" /> View official text
          </a>
        </div>
      )}
    </div>
  )
}

// ─── Latest cards ────────────────────────────────────────────────────────────
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
                <span className="text-xs text-muted-foreground">
                  {new Date(reg.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                </span>
              </div>
              <p className="font-semibold text-sm mt-2 leading-snug">{reg.name}</p>
              <div className="flex gap-1 flex-wrap mt-1.5">
                {reg.tags?.map(t => (
                  <span key={t} className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{t}</span>
                ))}
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
        <SelectTrigger className="w-full md:w-80">
          <SelectValue placeholder="Select a regulation" />
        </SelectTrigger>
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

// ─── Root ────────────────────────────────────────────────────────────────────
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
      {/* Header + filter bar */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Scale className="h-5 w-5" />
            BCB Regulatory Timeline
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Banco Central do Brasil · 2017–2025</p>
        </div>

        {!loading && !error && (
          <FilterBar
            activeTags={activeTags}   onTagsChange={setActiveTags}
            activeYears={activeYears} onYearsChange={setActiveYears}
            years={years}
            totalCount={regulations.length}
            filteredCount={filtered.length}
          />
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-destructive">Failed to load regulations</p>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">{error}</p>
          </div>
        </div>
      )}

      {/* Timeline */}
      <section>
        <h2 className="text-base font-semibold mb-4">Timeline</h2>
        {loading ? <TimelineSkeleton /> : <RegulationsTimeline regulations={filtered} />}
      </section>

      {/* Latest 5 */}
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
        ) : (
          <LatestRegulationsCards regulations={latestFive} />
        )}
      </section>

      {/* Impact analysis */}
      <section>
        <h2 className="text-base font-semibold mb-1">Impact Analysis</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Select a regulation to view first, second, and third-order implications.
        </p>
        {loading ? (
          <div className="animate-pulse h-10 bg-muted rounded w-80" />
        ) : (
          <ImpactFilterSection regulations={filtered} />
        )}
      </section>
    </div>
  )
}
