'use client'

import { useState, useEffect, useMemo } from 'react'
import { Scale, ExternalLink, X, AlertTriangle } from 'lucide-react'
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

const ALL_TAGS = ['Crypto', 'Payments', 'Banking', 'Open Finance', 'AML', 'Credit', 'Capital Markets', 'ESG', 'Data & Privacy', 'FX'] as const
type Tag = typeof ALL_TAGS[number]

const BCB_STYLE = { dot: 'bg-emerald-500', badge: 'bg-emerald-500/10', badgeText: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500', label: 'BCB' }

const ISSUER_STYLES: Record<Issuer, typeof BCB_STYLE> = {
  CVM:   { dot: 'bg-blue-500',    badge: 'bg-blue-500/10',    badgeText: 'text-blue-600 dark:text-blue-400',    border: 'border-blue-500',   label: 'CVM' },
  BCB:   BCB_STYLE,
  CMN:   { dot: 'bg-amber-500',   badge: 'bg-amber-500/10',   badgeText: 'text-amber-600 dark:text-amber-400',   border: 'border-amber-500',  label: 'CMN' },
  OTHER: { dot: 'bg-violet-500',  badge: 'bg-violet-500/10',  badgeText: 'text-violet-600 dark:text-violet-400', border: 'border-violet-500', label: 'Other' },
}

const ORDER_CONFIG = [
  { key: 'firstOrder' as const,  label: '1st Order', sub: 'Direct compliance obligations',    border: 'border-l-red-400' },
  { key: 'secondOrder' as const, label: '2nd Order', sub: 'Indirectly affected players',      border: 'border-l-amber-400' },
  { key: 'thirdOrder' as const,  label: '3rd Order', sub: 'Ecosystem & startup implications', border: 'border-l-blue-400' },
]

function TimelineSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 bg-muted rounded w-48" />
      <div className="h-16 bg-muted rounded" />
    </div>
  )
}

function TagFilter({ activeTag, onChange }: { activeTag: Tag | null; onChange: (t: Tag | null) => void }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      <button
        onClick={() => onChange(null)}
        className={`px-2.5 py-1 rounded-full text-xs border transition-all ${
          !activeTag ? 'bg-foreground text-background border-transparent' : 'text-muted-foreground border-border hover:text-foreground'
        }`}
      >
        All
      </button>
      {ALL_TAGS.map(tag => (
        <button
          key={tag}
          onClick={() => onChange(activeTag === tag ? null : tag)}
          className={`px-2.5 py-1 rounded-full text-xs border transition-all ${
            activeTag === tag
              ? 'bg-foreground text-background border-transparent'
              : 'text-muted-foreground border-border hover:text-foreground'
          }`}
        >
          {tag}
        </button>
      ))}
    </div>
  )
}

function RegulationsTimeline({ regulations }: { regulations: Regulation[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTag, setActiveTag] = useState<Tag | null>(null)
  const [filteredYear, setFilteredYear] = useState<string | null>(null)

  const years = useMemo(() =>
    Array.from(new Set(regulations.map(r => r.date.slice(0, 4)))).sort()
  , [regulations])

  const filtered = useMemo(() => regulations.filter(r => {
    if (activeTag && !r.tags?.includes(activeTag)) return false
    if (filteredYear && !r.date.startsWith(filteredYear)) return false
    return true
  }), [regulations, activeTag, filteredYear])

  const selected = regulations.find(r => r.id === selectedId) ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-start">
        <TagFilter activeTag={activeTag} onChange={setActiveTag} />
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setFilteredYear(null)}
            className={`px-2 py-0.5 rounded text-xs transition-colors ${
              !filteredYear ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            All years
          </button>
          {years.map(y => (
            <button
              key={y}
              onClick={() => setFilteredYear(filteredYear === y ? null : y)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                filteredYear === y ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      <div className="border rounded-lg bg-card overflow-hidden">
        <div className="overflow-x-auto select-none" style={{ touchAction: 'pan-x' }}>
          <div className="relative flex items-center min-w-max px-6 py-6 gap-0">
            <div className="absolute left-0 right-0 top-1/2 h-px bg-border -translate-y-1/2 pointer-events-none" />
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground py-2 px-4">No regulations match the selected filters.</p>
            )}
            {filtered.map((reg, i) => {
              const s = ISSUER_STYLES[reg.issuer]
              const isSelected = selectedId === reg.id
              const year = reg.date.slice(0, 4)
              const showYear = year !== (i > 0 ? filtered[i - 1].date.slice(0, 4) : null)
              const dateLabel = new Date(reg.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
              return (
                <div key={reg.id} className="flex flex-col items-center min-w-[120px] relative">
                  <div className="h-5 flex items-center justify-center mb-1">
                    {showYear && (
                      <span className="text-[10px] font-semibold text-muted-foreground tracking-wider uppercase">{year}</span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground mb-1.5 truncate max-w-[110px] text-center">{reg.shortName}</span>
                  <button
                    onClick={() => setSelectedId(isSelected ? null : reg.id)}
                    className={`relative z-10 w-3 h-3 rounded-full transition-all duration-150 ${s.dot} ${
                      isSelected
                        ? `scale-150 ring-2 ring-offset-2 ring-offset-background ${s.dot.replace('bg-', 'ring-')}`
                        : 'hover:scale-125 ring-2 ring-background'
                    }`}
                    title={reg.name}
                  />
                  <span className="text-[10px] text-muted-foreground mt-1.5 text-center">{dateLabel}</span>
                </div>
              )
            })}
          </div>
        </div>

        {selected && (
          <div className="border-t bg-muted/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={`${ISSUER_STYLES[selected.issuer].badge} ${ISSUER_STYLES[selected.issuer].badgeText} border-0 text-xs`}>
                  {ISSUER_STYLES[selected.issuer].label}
                </Badge>
                <span className="font-semibold text-sm">{selected.name}</span>
                {selected.tags?.map(t => (
                  <span key={t} className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{t}</span>
                ))}
              </div>
              <button onClick={() => setSelectedId(null)} className="text-muted-foreground hover:text-foreground shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {new Date(selected.date + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            <p className="text-sm mt-3">{selected.description}</p>
            <a href={selected.officialUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 mt-3 hover:underline">
              <ExternalLink className="h-3 w-3" />
              View official text
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

function LatestRegulationsCards({ regulations }: { regulations: Regulation[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {regulations.map(reg => {
        const s = ISSUER_STYLES[reg.issuer]
        return (
          <Card key={reg.id} className="flex flex-col">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <Badge className={`${s.badge} ${s.badgeText} border-0 text-xs`}>{s.label}</Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(reg.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                </span>
              </div>
              <p className="font-semibold text-sm mt-1">{reg.name}</p>
              <div className="flex gap-1 flex-wrap mt-1">
                {reg.tags?.map(t => (
                  <span key={t} className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{t}</span>
                ))}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col flex-1 gap-3">
              <p className="text-sm text-muted-foreground">{reg.fullContext}</p>
              <div className="bg-muted rounded p-3 text-xs">
                <span className="font-medium">What changed: </span>
                <span className="text-muted-foreground">{reg.whatChanged}</span>
              </div>
              <a href={reg.officialUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 mt-auto hover:underline">
                <ExternalLink className="h-3 w-3" />
                View official text
              </a>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

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
              <SelectItem key={r.id} value={r.id}>
                {r.shortName} – {r.date.slice(0, 4)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {reg && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {ORDER_CONFIG.map(order => (
            <div key={order.key} className="border rounded-lg p-4 space-y-3">
              <div>
                <p className="font-semibold text-sm">{order.label}</p>
                <p className="text-xs text-muted-foreground">{order.sub}</p>
              </div>
              <Separator />
              {reg.impacts[order.key].map((entry, i) => (
                <div key={i} className={`border-l-2 pl-3 ${order.border} space-y-1`}>
                  <Badge variant="secondary" className="text-[10px] h-auto py-0.5">{entry.sectorOrType}</Badge>
                  <p className="text-xs text-muted-foreground">{entry.why}</p>
                  {i < reg.impacts[order.key].length - 1 && <Separator className="mt-2" />}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function RegulacoesBRClient() {
  const [regulations, setRegulations] = useState<Regulation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTag, setActiveTag] = useState<Tag | null>(null)

  useEffect(() => {
    fetch('/api/regulacoes')
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${r.status} — ${r.statusText}`)
        }
        return r.json()
      })
      .then((data: Regulation[]) => {
        setRegulations(data)
        setLoading(false)
      })
      .catch(e => {
        setError(e.message)
        setLoading(false)
      })
  }, [])

  const filteredByTag = useMemo(
    () => activeTag ? regulations.filter(r => r.tags?.includes(activeTag)) : regulations,
    [regulations, activeTag]
  )

  const latestFive = useMemo(
    () => [...filteredByTag].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
    [filteredByTag]
  )

  return (
    <div className="p-4 md:py-8 md:px-8 space-y-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Scale className="h-5 w-5" />
          BCB Regulatory Timeline
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Banco Central do Brasil · 2017–2025
        </p>
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

      {/* Global tag filter */}
      {!loading && !error && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Filter by topic</p>
          <TagFilter activeTag={activeTag} onChange={setActiveTag} />
        </div>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-4">Timeline</h2>
        {loading ? <TimelineSkeleton /> : <RegulationsTimeline regulations={filteredByTag} />}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-4">Latest 5 Regulations</h2>
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

      <section>
        <h2 className="text-lg font-semibold mb-1">Impact Analysis</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Select a regulation to view first, second, and third-order implications — which markets, industries, and startups are affected and why.
        </p>
        {loading ? (
          <div className="animate-pulse h-10 bg-muted rounded w-80" />
        ) : (
          <ImpactFilterSection regulations={filteredByTag} />
        )}
      </section>
    </div>
  )
}
