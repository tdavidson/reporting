'use client'

import { useState, useEffect, useMemo } from 'react'
import { Scale, ExternalLink, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
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

const ISSUER_STYLES: Record<Issuer, { dot: string; badge: string; badgeText: string; label: string }> = {
  CVM:   { dot: 'bg-blue-500',    badge: 'bg-blue-500/10',    badgeText: 'text-blue-600 dark:text-blue-400',       label: 'CVM' },
  BCB:   { dot: 'bg-emerald-500', badge: 'bg-emerald-500/10', badgeText: 'text-emerald-600 dark:text-emerald-400', label: 'BCB' },
  CMN:   { dot: 'bg-amber-500',   badge: 'bg-amber-500/10',   badgeText: 'text-amber-600 dark:text-amber-400',     label: 'CMN' },
  OTHER: { dot: 'bg-violet-500',  badge: 'bg-violet-500/10',  badgeText: 'text-violet-600 dark:text-violet-400',   label: 'Other' },
}

const ORDER_CONFIG = [
  { key: 'firstOrder' as const,  label: '1st Order', sub: 'Direct compliance obligations',    accent: 'bg-red-400' },
  { key: 'secondOrder' as const, label: '2nd Order', sub: 'Indirectly affected players',      accent: 'bg-amber-400' },
  { key: 'thirdOrder' as const,  label: '3rd Order', sub: 'Ecosystem & startup implications', accent: 'bg-blue-400' },
]

function TagFilter({ activeTag, onChange }: { activeTag: Tag | null; onChange: (t: Tag | null) => void }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      <button
        onClick={() => onChange(null)}
        className={`px-2.5 py-1 rounded-full text-xs border transition-all ${
          !activeTag ? 'bg-foreground text-background border-transparent' : 'text-muted-foreground border-border hover:text-foreground'
        }`}
      >All</button>
      {ALL_TAGS.map(tag => (
        <button
          key={tag}
          onClick={() => onChange(activeTag === tag ? null : tag)}
          className={`px-2.5 py-1 rounded-full text-xs border transition-all ${
            activeTag === tag ? 'bg-foreground text-background border-transparent' : 'text-muted-foreground border-border hover:text-foreground'
          }`}
        >{tag}</button>
      ))}
    </div>
  )
}

function TimelineSkeleton() {
  return (
    <div className="space-y-0 border rounded-lg overflow-hidden">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex gap-4 p-4 border-b last:border-b-0 animate-pulse">
          <div className="w-16 shrink-0 space-y-1">
            <div className="h-3 bg-muted rounded w-12" />
            <div className="h-3 bg-muted rounded w-8" />
          </div>
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-muted rounded w-48" />
            <div className="h-3 bg-muted rounded w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

function RegulationsTimeline({ regulations }: { regulations: Regulation[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filteredYear, setFilteredYear] = useState<string | null>(null)

  const years = useMemo(() =>
    Array.from(new Set(regulations.map(r => r.date.slice(0, 4)))).sort()
  , [regulations])

  const filtered = useMemo(() =>
    regulations.filter(r => !filteredYear || r.date.startsWith(filteredYear))
  , [regulations, filteredYear])

  // Group by year
  const grouped = useMemo(() => {
    const map = new Map<string, Regulation[]>()
    filtered.forEach(r => {
      const y = r.date.slice(0, 4)
      if (!map.has(y)) map.set(y, [])
      map.get(y)!.push(r)
    })
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtered])

  return (
    <div className="space-y-3">
      {/* Year filter */}
      <div className="flex gap-1.5 flex-wrap">
        <button
          onClick={() => setFilteredYear(null)}
          className={`px-2.5 py-1 rounded-full text-xs border transition-all ${
            !filteredYear ? 'bg-foreground text-background border-transparent' : 'text-muted-foreground border-border hover:text-foreground'
          }`}
        >All years</button>
        {years.map(y => (
          <button
            key={y}
            onClick={() => setFilteredYear(filteredYear === y ? null : y)}
            className={`px-2.5 py-1 rounded-full text-xs border transition-all ${
              filteredYear === y ? 'bg-foreground text-background border-transparent' : 'text-muted-foreground border-border hover:text-foreground'
            }`}
          >{y}</button>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground py-6 text-center">No regulations match the selected filters.</p>
      )}

      {/* Grouped vertical timeline */}
      <div className="space-y-6">
        {grouped.map(([year, regs]) => (
          <div key={year}>
            {/* Year header */}
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-semibold text-muted-foreground tracking-widest uppercase">{year}</span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">{regs.length} regulation{regs.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Regulation rows */}
            <div className="border rounded-lg overflow-hidden divide-y">
              {regs.map(reg => {
                const s = ISSUER_STYLES[reg.issuer]
                const isOpen = expandedId === reg.id
                const month = new Date(reg.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

                return (
                  <div key={reg.id}>
                    <button
                      onClick={() => setExpandedId(isOpen ? null : reg.id)}
                      className="w-full flex items-center gap-4 px-4 py-3.5 text-left hover:bg-muted/40 transition-colors group"
                    >
                      {/* Date */}
                      <span className="text-xs text-muted-foreground w-14 shrink-0 tabular-nums">{month}</span>

                      {/* Dot */}
                      <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />

                      {/* Name + tags */}
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium truncate block">{reg.name}</span>
                        <div className="flex gap-1 flex-wrap mt-1">
                          {reg.tags?.map(t => (
                            <span key={t} className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{t}</span>
                          ))}
                        </div>
                      </div>

                      {/* Issuer badge */}
                      <Badge className={`${s.badge} ${s.badgeText} border-0 text-xs shrink-0 hidden sm:inline-flex`}>
                        {s.label}
                      </Badge>

                      {/* Chevron */}
                      <span className="text-muted-foreground shrink-0">
                        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </span>
                    </button>

                    {/* Expanded detail */}
                    {isOpen && (
                      <div className="px-4 pb-4 pt-1 bg-muted/20 border-t space-y-3">
                        <p className="text-sm text-muted-foreground">{reg.description}</p>
                        {reg.whatChanged && (
                          <div className="bg-muted rounded-md px-3 py-2 text-xs">
                            <span className="font-medium text-foreground">What changed: </span>
                            <span className="text-muted-foreground">{reg.whatChanged}</span>
                          </div>
                        )}
                        <a
                          href={reg.officialUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          View official text
                        </a>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
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
      .then((data: Regulation[]) => { setRegulations(data); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
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
    <div className="p-4 md:py-8 md:px-8 space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Scale className="h-5 w-5" />
          BCB Regulatory Timeline
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Banco Central do Brasil · 2017–2025</p>
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

      {/* Global tag filter */}
      {!loading && !error && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Filter by topic</p>
          <TagFilter activeTag={activeTag} onChange={setActiveTag} />
        </div>
      )}

      {/* Timeline */}
      <section>
        <h2 className="text-base font-semibold mb-4">Timeline</h2>
        {loading ? <TimelineSkeleton /> : <RegulationsTimeline regulations={filteredByTag} />}
      </section>

      {/* Latest cards */}
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
