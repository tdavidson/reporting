'use client'

import { useState, useEffect } from 'react'
import { Newspaper, ExternalLink, RefreshCw, Filter, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import type { NewsArticle } from '@/app/api/news/route'

interface Company { id: string; name: string }

const NEWS_SOURCES_KEY = 'prlx:newsSources'

function getSavedSources(): string[] {
  try {
    const raw = localStorage.getItem(NEWS_SOURCES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

const DATE_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
]

export default function NewsPage() {
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [countriesAvailable, setCountriesAvailable] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedCompany, setSelectedCompany] = useState<string>('')
  const [dateRange, setDateRange] = useState<string>('all')
  const [country, setCountry] = useState<string>('all')
  const [error, setError] = useState<string | null>(null)
  const [sources, setSources] = useState<string[]>([])

  useEffect(() => {
    setSources(getSavedSources())
  }, [])

  async function load(bust = false) {
    try {
      const currentSources = getSavedSources()
      const params = new URLSearchParams()
      if (bust) params.set('bust', String(Date.now()))
      if (currentSources.length > 0) params.set('sources', currentSources.join(','))
      if (dateRange !== 'all') params.set('dateRange', dateRange)
      if (country !== 'all') params.set('country', country)
      const res = await fetch(`/api/news?${params}`)
      if (!res.ok) throw new Error('Failed to load news')
      const data = await res.json()
      setArticles(data.articles ?? [])
      setCompanies(data.companies ?? [])
      setCountriesAvailable(data.countriesInResults ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  useEffect(() => {
    load().finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-fetch when filters change (except on first mount)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (!mounted) { setMounted(true); return }
    setLoading(true)
    load().finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, country])

  async function handleRefresh() {
    setRefreshing(true)
    await load(true)
    setRefreshing(false)
  }

  const filtered = selectedCompany
    ? articles.filter(a => a.companyId === selectedCompany)
    : articles

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Newspaper className="h-5 w-5" />
            News
          </h1>
          <div className="flex items-center gap-2">
            {sources.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {sources.length} portal{sources.length !== 1 ? 's' : ''} configured
              </span>
            )}
            <Link href="/settings#news-sources">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Settings2 className="h-3.5 w-3.5" />
                Portals
              </Button>
            </Link>
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

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Date filter */}
        <div className="flex items-center gap-1.5">
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

        {/* Country filter */}
        {countriesAvailable.length > 1 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Country:</span>
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => setCountry('all')}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  country === 'all'
                    ? 'bg-foreground text-background border-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                All
              </button>
              {countriesAvailable.map(c => (
                <button
                  key={c}
                  onClick={() => setCountry(country === c ? 'all' : c)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    country === c
                      ? 'bg-foreground text-background border-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Company filter */}
      {companies.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-6">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <button
            onClick={() => setSelectedCompany('')}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              !selectedCompany
                ? 'bg-foreground text-background border-foreground'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            All
          </button>
          {companies.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedCompany(selectedCompany === c.id ? '' : c.id)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                selectedCompany === c.id
                  ? 'bg-foreground text-background border-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* States */}
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

      {!loading && !error && filtered.length === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Newspaper className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No news found for the selected filters.</p>
          <p className="text-xs text-muted-foreground mt-1">Try adjusting the period or country filter, or refreshing.</p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((article, i) => (
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
