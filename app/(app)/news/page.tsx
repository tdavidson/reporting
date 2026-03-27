'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Newspaper, ExternalLink, RefreshCw, Settings2, X, Check, Building2, Tag,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { NewsArticle, NewsCategory } from '@/app/api/news/route'

// ─── Constants ───────────────────────────────────────────────────────────────

const NEWS_SOURCES_KEY = 'prlx:newsSources'

const PRESET_PORTALS = [
  { label: 'Pipeline Valor',   url: 'pipelinevalor.globo.com' },
  { label: 'Brazil Journal',   url: 'braziljournal.com' },
  { label: 'NeoFeed',          url: 'neofeed.com.br' },
  { label: 'Finsiders Brasil', url: 'finsidersbrasil.com.br' },
  { label: 'Valor Econômico',  url: 'valor.globo.com' },
  { label: 'LATAM List',       url: 'latamlist.com' },
  { label: 'Crunchbase News',  url: 'news.crunchbase.com' },
  { label: 'Startups.com.br',  url: 'startups.com.br' },
  { label: 'Startupi',         url: 'startupi.com.br' },
  { label: 'LATAM Fintech',    url: 'latamfintech.co' },
]

// "all" = no date filter; others = relative presets; "custom" = fromDate input is shown
const DATE_OPTIONS = [
  { value: 'all',      label: 'All time' },
  { value: '24h',      label: '24 h' },
  { value: '7d',       label: '7 days' },
  { value: '30d',      label: '30 days' },
  { value: 'ytd',      label: 'YTD' },
  { value: 'lastyear', label: 'Last year' },
  { value: 'custom',   label: 'Custom…' },
]

const CATEGORY_CONFIG: Record<string, { label: string; className: string }> = {
  rodada:      { label: 'Rodada',      className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  ipo:         { label: 'IPO',         className: 'bg-violet-500/15 text-violet-600 border-violet-500/30' },
  aquisicao:   { label: 'M&A',         className: 'bg-orange-500/15 text-orange-600 border-orange-500/30' },
  parceria:    { label: 'Parceria',    className: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
  contratacao: { label: 'Contratação', className: 'bg-yellow-500/15 text-yellow-700 border-yellow-500/30' },
  produto:     { label: 'Produto',     className: 'bg-cyan-500/15 text-cyan-600 border-cyan-500/30' },
  expansao:    { label: 'Expansão',    className: 'bg-indigo-500/15 text-indigo-600 border-indigo-500/30' },
  premio:      { label: 'Prêmio',      className: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  crise:       { label: 'Crise',       className: 'bg-red-500/15 text-red-600 border-red-500/30' },
  outro:       { label: 'Outro',       className: 'bg-muted text-muted-foreground border-border' },
  // legacy compat
  featured:    { label: 'Destaque',    className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  mentioned:   { label: 'Mencionada', className: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
}

// ─── Types ────────────────────────────────────────────────────────────────────

type AnyArticle = Omit<NewsArticle, 'category'> & { category?: NewsCategory; relevance?: string }
interface Company { id: string; name: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTag(article: AnyArticle) {
  const key = article.category ?? (article as any).relevance ?? 'outro'
  return CATEGORY_CONFIG[key] ?? CATEGORY_CONFIG.outro
}

function getSavedSources(): string[] {
  try { return JSON.parse(localStorage.getItem(NEWS_SOURCES_KEY) ?? '[]') } catch { return [] }
}
function setSavedSources(s: string[]): void {
  localStorage.setItem(NEWS_SOURCES_KEY, JSON.stringify(s))
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

/** Build URLSearchParams for the /api/news request */
function buildParams(opts: {
  bust?: boolean
  sources: string[]
  dateRange: string
  fromDate: string
}): URLSearchParams {
  const p = new URLSearchParams()
  if (opts.bust) p.set('bust', String(Date.now()))
  if (opts.sources.length > 0) p.set('sources', opts.sources.join(','))

  if (opts.dateRange === 'custom' && opts.fromDate) {
    p.set('fromDate', opts.fromDate)
  } else if (opts.dateRange !== 'all' && opts.dateRange !== 'custom') {
    // Pass relative range; API already supports these values
    p.set('dateRange', opts.dateRange)
  }

  return p
}

// ─── Portals Modal ────────────────────────────────────────────────────────────

function PortalsModal({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<string[]>(getSavedSources)

  const toggle = (url: string) =>
    setSelected(prev => prev.includes(url) ? prev.filter(s => s !== url) : [...prev, url])

  const handleSave = () => { setSavedSources(selected); onClose() }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-background border rounded-xl shadow-xl w-full max-w-md mx-4 p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold">News Portals</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Select portals to prioritise. Leave all unchecked to search across all sources.
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESET_PORTALS.map(p => {
            const active = selected.includes(p.url)
            return (
              <button
                key={p.url}
                onClick={() => toggle(p.url)}
                className={`flex items-center gap-2 text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                  active
                    ? 'border-foreground/40 bg-accent font-medium'
                    : 'border-border text-muted-foreground hover:bg-accent/40'
                }`}
              >
                <span
                  className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 ${
                    active ? 'bg-foreground border-foreground' : 'border-muted-foreground'
                  }`}
                >
                  {active && <Check className="h-2.5 w-2.5 text-background" />}
                </span>
                {p.label}
              </button>
            )
          })}
        </div>
        <div className="flex justify-between items-center mt-4 pt-3 border-t">
          <button
            onClick={() => setSelected([])}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear all
          </button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleSave}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Companies Modal ──────────────────────────────────────────────────────────

function CompaniesModal({
  companies,
  selected,
  onSave,
  onClose,
}: {
  companies: Company[]
  selected: string[]
  onSave: (ids: string[]) => void
  onClose: () => void
}) {
  const [local, setLocal] = useState<string[]>(selected)
  const allChecked = local.length === companies.length

  const toggleAll = () => setLocal(allChecked ? [] : companies.map(c => c.id))
  const toggle = (id: string) =>
    setLocal(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const handleSave = () => { onSave(local); onClose() }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-background border rounded-xl shadow-xl w-full max-w-sm mx-4 p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Filter by company</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <button
          onClick={toggleAll}
          className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg border text-xs mb-2 transition-colors ${
            allChecked
              ? 'border-foreground/40 bg-accent'
              : 'border-border text-muted-foreground hover:bg-accent/40'
          }`}
        >
          <span
            className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 ${
              allChecked ? 'bg-foreground border-foreground' : 'border-muted-foreground'
            }`}
          >
            {allChecked && <Check className="h-2.5 w-2.5 text-background" />}
          </span>
          All companies
        </button>

        <div className="space-y-1 max-h-64 overflow-y-auto">
          {companies.map(c => {
            const active = local.includes(c.id)
            return (
              <button
                key={c.id}
                onClick={() => toggle(c.id)}
                className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                  active
                    ? 'border-foreground/40 bg-accent font-medium'
                    : 'border-border text-muted-foreground hover:bg-accent/40'
                }`}
              >
                <span
                  className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 ${
                    active ? 'bg-foreground border-foreground' : 'border-muted-foreground'
                  }`}
                >
                  {active && <Check className="h-2.5 w-2.5 text-background" />}
                </span>
                <span className="truncate">{c.name}</span>
              </button>
            )
          })}
        </div>

        <div className="flex justify-end gap-2 mt-4 pt-3 border-t">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave}>Apply</Button>
        </div>
      </div>
    </div>
  )
}

// ─── Filter pill helper ───────────────────────────────────────────────────────

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
        active
          ? 'bg-foreground text-background border-foreground'
          : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/40'
      }`}
    >
      {children}
    </button>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NewsPage() {
  const [articles,          setArticles]          = useState<AnyArticle[]>([])
  const [companies,         setCompanies]          = useState<Company[]>([])
  const [loading,           setLoading]            = useState(true)
  const [refreshing,        setRefreshing]         = useState(false)
  const [error,             setError]              = useState<string | null>(null)

  // Filters
  const [dateRange,         setDateRange]          = useState<string>('all')
  const [fromDate,          setFromDate]           = useState<string>('')
  const [selectedCompanies, setSelectedCompanies]  = useState<string[]>([])
  const [selectedCategory,  setSelectedCategory]   = useState<string>('all')

  // Modals
  const [showPortals,       setShowPortals]        = useState(false)
  const [showCompanies,     setShowCompanies]      = useState(false)

  // Derived
  const sources       = getSavedSources()
  const filterActive  = selectedCompanies.length > 0 && selectedCompanies.length < companies.length

  // ── Data fetching ──────────────────────────────────────────────────────────

  const load = useCallback(async (bust = false) => {
    try {
      const currentSources = getSavedSources()
      const params = buildParams({ bust, sources: currentSources, dateRange, fromDate })
      const res = await fetch(`/api/news?${params}`)
      if (!res.ok) throw new Error('Failed to load news')
      const data = await res.json()
      setArticles(data.articles ?? [])
      if (data.companies) setCompanies(data.companies)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }, [dateRange, fromDate])

  // Initial load
  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  async function handleRefresh() {
    setRefreshing(true)
    await load(true)
    setRefreshing(false)
  }

  const handlePortalsClose = () => {
    setShowPortals(false)
    setLoading(true)
    load().finally(() => setLoading(false))
  }

  // ── Client-side filtering ──────────────────────────────────────────────────

  const filtered = articles.filter(a => {
    if (selectedCompanies.length > 0 && !selectedCompanies.includes(a.companyId)) return false
    if (selectedCategory !== 'all') {
      const key = a.category ?? (a as any).relevance ?? 'outro'
      if (key !== selectedCategory) return false
    }
    return true
  })

  // Categories that actually appear in the current result set
  const presentCategories = Array.from(
    new Set(articles.map(a => a.category ?? (a as any).relevance ?? 'outro'))
  ).filter(k => CATEGORY_CONFIG[k])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">

      {/* Modals */}
      {showPortals && <PortalsModal onClose={handlePortalsClose} />}
      {showCompanies && (
        <CompaniesModal
          companies={companies}
          selected={selectedCompanies}
          onSave={setSelectedCompanies}
          onClose={() => setShowCompanies(false)}
        />
      )}

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Newspaper className="h-5 w-5" />
              News
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Latest news about your portfolio companies · cached for 1h
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {sources.length > 0 && (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {sources.length} portal{sources.length !== 1 ? 's' : ''}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setShowPortals(true)}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Portals
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing || loading}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col gap-3 mb-6">

        {/* Row 1: Date range + company filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground shrink-0">Period:</span>
          {DATE_OPTIONS.map(opt => (
            <FilterPill
              key={opt.value}
              active={dateRange === opt.value}
              onClick={() => {
                setDateRange(opt.value)
                if (opt.value !== 'custom') setFromDate('')
              }}
            >
              {opt.label}
            </FilterPill>
          ))}

          {/* Custom date input — shown only when "Custom…" is selected */}
          {dateRange === 'custom' && (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                className="text-xs px-2 py-1 rounded-md border bg-transparent text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {fromDate && (
                <button
                  onClick={() => setFromDate('')}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Clear date"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}

          {/* Company filter */}
          {companies.length > 0 && (
            <button
              onClick={() => setShowCompanies(true)}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ml-auto ${
                filterActive
                  ? 'bg-foreground text-background border-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/40'
              }`}
            >
              <Building2 className="h-3 w-3" />
              {filterActive ? `${selectedCompanies.length} companies` : 'All companies'}
            </button>
          )}
        </div>

        {/* Row 2: Category filter (only shown when there are multiple categories) */}
        {presentCategories.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground shrink-0">
              <Tag className="h-3 w-3 inline mr-1 -mt-px" />
              Category:
            </span>
            <FilterPill active={selectedCategory === 'all'} onClick={() => setSelectedCategory('all')}>
              All
            </FilterPill>
            {presentCategories.map(key => {
              const cfg = CATEGORY_CONFIG[key]
              return (
                <FilterPill
                  key={key}
                  active={selectedCategory === key}
                  onClick={() => setSelectedCategory(selectedCategory === key ? 'all' : key)}
                >
                  {cfg.label}
                </FilterPill>
              )
            })}
          </div>
        )}
      </div>

      {/* Results count */}
      {!loading && !error && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground mb-3">
          {filtered.length} article{filtered.length !== 1 ? 's' : ''}
          {(filterActive || selectedCategory !== 'all') ? ' (filtered)' : ''}
        </p>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="rounded-lg border p-4 animate-pulse">
              <div className="h-4 bg-muted rounded w-3/4 mb-2" />
              <div className="h-3 bg-muted rounded w-1/3" />
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => load()}>
            Try again
          </Button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filtered.length === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Newspaper className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No news found.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Try adjusting the filters or refreshing.
          </p>
          {(filterActive || selectedCategory !== 'all') && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                setSelectedCompanies([])
                setSelectedCategory('all')
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      )}

      {/* Article list */}
      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((article, i) => {
            const tag = getTag(article)
            return (
              <a
                key={i}
                href={article.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 rounded-lg border bg-card p-4 hover:bg-accent/50 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-snug group-hover:underline">
                    {article.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {article.companyName}
                    </Badge>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${tag.className}`}
                    >
                      {tag.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{article.source}</span>
                    {article.pubDate && (
                      <span className="text-[11px] text-muted-foreground">
                        {timeAgo(article.pubDate)}
                      </span>
                    )}
                  </div>
                </div>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}
