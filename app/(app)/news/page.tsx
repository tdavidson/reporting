'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Newspaper,
  ExternalLink,
  RefreshCw,
  X,
  CheckCircle2,
  AlertCircle,
  Search,
  ChevronDown,
  Sparkles,
  Clock,
  Building2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { NewsArticle, NewsCategory, RefreshSummary } from '@/lib/news-pipeline'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATE_OPTIONS = [
  { value: '7d',  label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
  { value: 'ytd', label: 'Este ano' },
  { value: 'all', label: 'Tudo' },
]

const CATEGORY_CONFIG: Record<string, { label: string; className: string }> = {
  rodada:      { label: 'Rodada',      className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
  ipo:         { label: 'IPO',         className: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30' },
  aquisicao:   { label: 'M&A',         className: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30' },
  parceria:    { label: 'Parceria',    className: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30' },
  contratacao: { label: 'Contratação', className: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30' },
  produto:     { label: 'Produto',     className: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30' },
  expansao:    { label: 'Expansão',    className: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30' },
  premio:      { label: 'Prêmio',      className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' },
  crise:       { label: 'Crise',       className: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30' },
  outro:       { label: 'Outro',       className: 'bg-muted text-muted-foreground border-border' },
  featured:    { label: 'Destaque',    className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  mentioned:   { label: 'Mencionada',  className: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
}

type AnyArticle = Omit<NewsArticle, 'category'> & { category?: NewsCategory; relevance?: string }
interface Company { id: string; name: string }

function getTag(article: AnyArticle) {
  const key = article.category ?? (article as any).relevance ?? 'outro'
  return CATEGORY_CONFIG[key] ?? CATEGORY_CONFIG.outro
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60)  return `${mins}m atrás`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h atrás`
  const days = Math.floor(hrs / 24)
  if (days < 30)  return `${days}d atrás`
  return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')
}

function companyHue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff
  return Math.abs(h) % 360
}

// ---------------------------------------------------------------------------
// Refresh Summary Drawer
// ---------------------------------------------------------------------------

function RefreshDrawer({
  summary,
  onClose,
}: {
  summary: RefreshSummary | null
  loading: boolean
  onClose: () => void
}) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (summary) {
      setVisible(true)
      const t = setTimeout(() => { setVisible(false); setTimeout(onClose, 350) }, 8000)
      return () => clearTimeout(t)
    }
  }, [summary, onClose])

  const hide = () => { setVisible(false); setTimeout(onClose, 350) }

  if (!summary) return null

  const isEmpty  = summary.added === 0 && summary.duplicates === 0
  const hasAdded = summary.added > 0

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm transition-all duration-300 ease-out ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
      }`}
    >
      <div className="mx-4 bg-background border rounded-xl shadow-lg overflow-hidden">
        <div className={`flex items-center gap-2.5 px-4 py-3 border-b ${
          hasAdded ? 'bg-emerald-500/5' : isEmpty ? 'bg-muted/50' : 'bg-muted/30'
        }`}>
          {hasAdded ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
          ) : isEmpty ? (
            <Sparkles className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-tight">
              {hasAdded
                ? `${summary.added} nova${summary.added !== 1 ? 's notícias adicionadas' : ' notícia adicionada'}`
                : isEmpty
                  ? 'Nenhuma notícia nova encontrada'
                  : `${summary.duplicates} duplicata${summary.duplicates !== 1 ? 's' : ''} ignorada${summary.duplicates !== 1 ? 's' : ''}`
              }
            </p>
            {summary.duplicates > 0 && hasAdded && (
              <p className="text-xs text-muted-foreground">
                {summary.duplicates} duplicata{summary.duplicates !== 1 ? 's' : ''} ignorada{summary.duplicates !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          <button onClick={hide} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>

        {summary.byCompany.length > 0 && (
          <div className="px-4 py-2.5 space-y-1 max-h-40 overflow-y-auto">
            {summary.byCompany.map(c => (
              <div key={c.companyId} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground truncate max-w-[60%]">{c.companyName}</span>
                <div className="flex items-center gap-2">
                  {c.added > 0 && (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">+{c.added}</span>
                  )}
                  {c.duplicates > 0 && (
                    <span className="text-muted-foreground">{c.duplicates} dup.</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="px-4 py-2 border-t flex items-center gap-1.5">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">
            {new Date(summary.ranAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="text-[11px] text-muted-foreground ml-auto">{summary.total} artigos analisados</span>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline company filter
// ---------------------------------------------------------------------------

function CompanyFilterStrip({
  companies,
  selected,
  onChange,
}: {
  companies: Company[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [search, setSearch]     = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const filteredSearch = search
    ? companies.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
    : companies

  const allSelected = selected.length === 0 || selected.length === companies.length

  const toggle = useCallback((id: string) => {
    if (allSelected) {
      onChange(companies.filter(c => c.id !== id).map(c => c.id))
    } else {
      const next = selected.includes(id)
        ? selected.filter(x => x !== id)
        : [...selected, id]
      onChange(next.length === companies.length ? [] : next)
    }
  }, [allSelected, selected, companies, onChange])

  const resetAll = () => { onChange([]); setSearch(''); setExpanded(false) }

  const visible  = companies.slice(0, 8)
  const overflow = companies.length - 8

  if (companies.length === 0) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5" />
          Empresas
        </span>
        <div className="flex items-center gap-2">
          {!allSelected && (
            <button
              onClick={resetAll}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
            >
              Limpar filtro
            </button>
          )}
          {companies.length > 8 && (
            <button
              onClick={() => { setExpanded(e => !e); if (!expanded) setTimeout(() => inputRef.current?.focus(), 50) }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
            >
              {expanded ? 'Menos' : `+${overflow} mais`}
              <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Buscar empresa…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border bg-background focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={resetAll}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-all ${
            allSelected
              ? 'bg-foreground text-background border-foreground font-medium'
              : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
          }`}
        >
          Todas
        </button>

        {(expanded ? (search ? filteredSearch : companies) : visible).map(c => {
          const active = !allSelected && selected.includes(c.id)
          const hue    = companyHue(c.name)
          return (
            <button
              key={c.id}
              onClick={() => toggle(c.id)}
              className={`inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full text-xs border transition-all ${
                active
                  ? 'border-foreground/40 bg-accent font-semibold text-foreground'
                  : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
              }`}
            >
              <span
                className="inline-flex items-center justify-center rounded-full w-4 h-4 text-[9px] font-bold shrink-0"
                style={{ background: `hsl(${hue} 60% ${active ? '50%' : '70%'})`, color: active ? '#fff' : `hsl(${hue} 60% 25%)` }}
              >
                {initials(c.name)}
              </span>
              <span className="truncate max-w-[100px]">{c.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Article card
// ---------------------------------------------------------------------------

function ArticleCard({ article }: { article: AnyArticle }) {
  const tag = getTag(article)
  const hue = companyHue(article.companyName)

  return (
    <a
      href={article.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-3 rounded-xl border bg-card p-3.5 hover:bg-accent/40 hover:border-border/80 transition-all duration-150"
    >
      <span
        className="mt-0.5 inline-flex items-center justify-center rounded-lg w-8 h-8 text-[11px] font-bold shrink-0"
        style={{ background: `hsl(${hue} 55% 88%)`, color: `hsl(${hue} 55% 28%)` }}
        aria-hidden
      >
        {initials(article.companyName)}
      </span>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug text-foreground line-clamp-2">{article.title}</p>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">{article.companyName}</Badge>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium shrink-0 ${tag.className}`}>{tag.label}</span>
          <span className="text-[11px] text-muted-foreground shrink-0">{article.source}</span>
          {article.pubDate && (
            <span className="text-[11px] text-muted-foreground shrink-0">{timeAgo(article.pubDate)}</span>
          )}
        </div>
      </div>

      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
    </a>
  )
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function SkeletonArticle() {
  return (
    <div className="flex items-start gap-3 rounded-xl border p-3.5 animate-pulse">
      <div className="w-8 h-8 rounded-lg bg-muted shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-muted rounded w-3/4" />
        <div className="h-3 bg-muted rounded w-1/2" />
        <div className="flex gap-2">
          <div className="h-3 bg-muted rounded w-16" />
          <div className="h-3 bg-muted rounded w-12" />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function NewsPage() {
  const [articles,          setArticles]          = useState<AnyArticle[]>([])
  const [companies,         setCompanies]         = useState<Company[]>([])
  const [loading,           setLoading]           = useState(true)
  const [refreshing,        setRefreshing]        = useState(false)
  const [dateRange,         setDateRange]         = useState<string>('7d')
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([])
  const [error,             setError]             = useState<string | null>(null)
  const [refreshSummary,    setRefreshSummary]    = useState<RefreshSummary | null>(null)
  const [showDrawer,        setShowDrawer]        = useState(false)

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (dateRange && dateRange !== 'all') params.set('dateRange', dateRange)
      if (selectedCompanies.length > 0)     params.set('companyIds', selectedCompanies.join(','))

      const res = await fetch(`/api/news?${params}`)
      if (!res.ok) throw new Error('Falha ao carregar notícias')
      const data = await res.json()
      setArticles(data.articles ?? [])
      if (data.companies) setCompanies(data.companies)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Algo deu errado')
    }
  }, [dateRange, selectedCompanies])

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [load])

  async function handleRefresh() {
    setRefreshing(true)
    setShowDrawer(false)
    setRefreshSummary(null)
    try {
      const res = await fetch('/api/news/refresh', { method: 'POST' })
      if (!res.ok) throw new Error('Refresh falhou')
      const summary: RefreshSummary = await res.json()
      setRefreshSummary(summary)
      setShowDrawer(true)
      setLoading(true)
      await load()
      setLoading(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh falhou')
    } finally {
      setRefreshing(false)
    }
  }

  const closeDrawer = () => { setShowDrawer(false); setRefreshSummary(null) }

  const filtered = selectedCompanies.length > 0
    ? articles.filter(a => selectedCompanies.includes(a.companyId))
    : articles

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
      {/* Refresh summary drawer */}
      {showDrawer && (
        <RefreshDrawer
          summary={refreshSummary}
          loading={refreshing}
          onClose={closeDrawer}
        />
      )}

      {/* Header — mesmo padrão do app */}
      <div className="mb-6 space-y-1">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">News Hub</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className="gap-1.5 shrink-0"
            aria-label="Atualizar notícias"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Buscando…' : 'Refresh'}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Repositório de notícias das empresas do portfólio
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 w-full">

          {/* Toolbar: period pills + company filter */}
          <div className="flex flex-col gap-3 mb-5">
            {/* Period pills */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground font-medium">Período:</span>
              {DATE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setDateRange(opt.value)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                    dateRange === opt.value
                      ? 'bg-foreground text-background border-foreground font-medium'
                      : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/40'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Company filter strip */}
            {companies.length > 0 && (
              <div className="p-3.5 rounded-xl border bg-card">
                <CompanyFilterStrip
                  companies={companies}
                  selected={selectedCompanies}
                  onChange={setSelectedCompanies}
                />
              </div>
            )}
          </div>

          {/* Loading skeleton */}
          {loading && (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => <SkeletonArticle key={i} />)}
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
              <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
              <p className="text-sm text-destructive font-medium">{error}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => { setLoading(true); load().finally(() => setLoading(false)) }}
              >
                Tentar novamente
              </Button>
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && filtered.length === 0 && (
            <div className="rounded-xl border border-dashed p-14 text-center">
              <Newspaper className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-sm font-medium text-muted-foreground">Nenhuma notícia encontrada</p>
              <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs mx-auto">
                Clique em <strong>Refresh</strong> para buscar as últimas notícias do portfólio.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4 gap-1.5"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Buscando…' : 'Buscar agora'}
              </Button>
            </div>
          )}

          {/* Article list */}
          {!loading && !error && filtered.length > 0 && (
            <div className="space-y-2">
              {filtered.map((article, i) => (
                <ArticleCard key={article.link ?? i} article={article} />
              ))}
              <p className="text-center text-xs text-muted-foreground pt-4 pb-2">
                {filtered.length} notícia{filtered.length !== 1 ? 's' : ''} no repositório
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
