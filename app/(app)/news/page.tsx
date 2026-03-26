'use client'

import { useState, useEffect } from 'react'
import { Newspaper, ExternalLink, RefreshCw, Settings2, X, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { NewsArticle } from '@/app/api/news/route'

const NEWS_SOURCES_KEY = 'prlx:newsSources'

const PRESET_PORTALS = [
  { label: 'TechCrunch', url: 'techcrunch.com' },
  { label: 'The Verge', url: 'theverge.com' },
  { label: 'Wired', url: 'wired.com' },
  { label: 'Bloomberg', url: 'bloomberg.com' },
  { label: 'Reuters', url: 'reuters.com' },
  { label: 'Financial Times', url: 'ft.com' },
  { label: 'Forbes', url: 'forbes.com' },
  { label: 'Business Insider', url: 'businessinsider.com' },
  { label: 'Fast Company', url: 'fastcompany.com' },
  { label: 'Inc.', url: 'inc.com' },
  { label: 'VentureBeat', url: 'venturebeat.com' },
  { label: 'Crunchbase News', url: 'news.crunchbase.com' },
  { label: 'Wall Street Journal', url: 'wsj.com' },
  { label: 'New York Times', url: 'nytimes.com' },
  { label: 'Axios', url: 'axios.com' },
  { label: 'The Information', url: 'theinformation.com' },
  { label: 'Sifted', url: 'sifted.eu' },
  { label: 'Valor Econômico', url: 'valor.globo.com' },
  { label: 'Folha de S.Paulo', url: 'folha.uol.com.br' },
  { label: 'Exame', url: 'exame.com' },
]

function getSavedSources(): string[] {
  try {
    const raw = localStorage.getItem(NEWS_SOURCES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function setSavedSources(sources: string[]) {
  localStorage.setItem(NEWS_SOURCES_KEY, JSON.stringify(sources))
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const DATE_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
]

function PortalsModal({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<string[]>(getSavedSources)

  const toggle = (url: string) => {
    setSelected(prev =>
      prev.includes(url) ? prev.filter(s => s !== url) : [...prev, url]
    )
  }

  const handleSave = () => {
    setSavedSources(selected)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-background border rounded-xl shadow-xl w-full max-w-md mx-4 p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">News Portals</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Select the portals to filter news results. Leave all unchecked to search across all sources.
        </p>
        <div className="grid grid-cols-2 gap-1.5 max-h-72 overflow-y-auto pr-1">
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
                <span className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 ${
                  active ? 'bg-foreground border-foreground' : 'border-muted-foreground'
                }`}>
                  {active && <Check className="h-2.5 w-2.5 text-background" />}
                </span>
                {p.label}
              </button>
            )
          })}
        </div>
        <div className="flex items-center justify-between mt-4 pt-3 border-t">
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

export default function NewsPage() {
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [dateRange, setDateRange] = useState<string>('all')
  const [error, setError] = useState<string | null>(null)
  const [sources, setSources] = useState<string[]>([])
  const [showPortals, setShowPortals] = useState(false)

  useEffect(() => {
    setSources(getSavedSources())
  }, [])

  async function load(bust = false) {
    try {
      const currentSources = getSavedSources()
      setSources(currentSources)
      const params = new URLSearchParams()
      if (bust) params.set('bust', String(Date.now()))
      if (currentSources.length > 0) params.set('sources', currentSources.join(','))
      if (dateRange !== 'all') params.set('dateRange', dateRange)
      const res = await fetch(`/api/news?${params}`)
      if (!res.ok) throw new Error('Failed to load news')
      const data = await res.json()
      setArticles(data.articles ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  useEffect(() => {
    load().finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (!mounted) { setMounted(true); return }
    setLoading(true)
    load().finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange])

  async function handleRefresh() {
    setRefreshing(true)
    await load(true)
    setRefreshing(false)
  }

  const handlePortalsClose = () => {
    setShowPortals(false)
    // reload with potentially updated sources
    setLoading(true)
    load().finally(() => setLoading(false))
  }

  return (
    <div className="p-4 md:p-8">
      {showPortals && <PortalsModal onClose={handlePortalsClose} />}

      <div className="mb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Newspaper className="h-5 w-5" />
            News
          </h1>
          <div className="flex items-center gap-2">
            {sources.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {sources.length} portal{sources.length !== 1 ? 's' : ''}
              </span>
            )}
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowPortals(true)}>
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
        <p className="text-sm text-muted-foreground mt-1">
          Latest news about your portfolio companies · cached for 1h
        </p>
      </div>

      {/* Date filter */}
      <div className="flex items-center gap-1.5 mb-6">
        <span className="text-xs text-muted-foreground">Period:</span>
        <div className="flex gap-1">
          {DATE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setDateRange(opt.value)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                dateRange === opt.value
                  ? 'bg-foreground text-background border-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="rounded-lg border p-4 animate-pulse">
              <div className="h-4 bg-muted rounded w-3/4 mb-2" />
              <div className="h-3 bg-muted rounded w-1/3" />
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => load()}>Try again</Button>
        </div>
      )}

      {!loading && !error && articles.length === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Newspaper className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No news found.</p>
          <p className="text-xs text-muted-foreground mt-1">Try adjusting the period filter or refreshing.</p>
        </div>
      )}

      {!loading && !error && articles.length > 0 && (
        <div className="space-y-2">
          {articles.map((article, i) => (
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
                  <span className="text-[11px] text-muted-foreground">{article.source}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {article.pubDate ? timeAgo(article.pubDate) : ''}
                  </span>
                </div>
              </div>
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
