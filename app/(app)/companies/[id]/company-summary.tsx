'use client'

import { useEffect, useState, useCallback } from 'react'
import { Sparkles, RefreshCw, Loader2, History, ChevronDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface HistoryEntry {
  id: string
  summary_text: string
  period_label: string | null
  created_at: string
}

interface SummaryData {
  summary: string | null
  period_label?: string | null
  generated_at?: string | null
  history?: HistoryEntry[]
}

interface Props {
  companyId: string
  hasClaudeKey?: boolean
  hasOpenAIKey?: boolean
  defaultAIProvider?: string
}

export function CompanySummary({ companyId, hasClaudeKey, hasOpenAIKey, defaultAIProvider }: Props) {
  const [data, setData] = useState<SummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<string>(defaultAIProvider ?? 'anthropic')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null)

  const showProviderToggle = hasClaudeKey && hasOpenAIKey

  // Load the latest stored summary
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/companies/${companyId}/summary`)
      if (res.ok) {
        const result = await res.json()
        setData(result)
        setViewingHistoryId(null)
      }
    } finally {
      setLoading(false)
    }
  }, [companyId])

  // Generate a new summary via POST
  async function generate() {
    setGenerating(true)
    setError(null)
    setViewingHistoryId(null)
    try {
      const res = await fetch(`/api/companies/${companyId}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(showProviderToggle ? { provider: selectedProvider } : {}),
      })
      const result = await res.json()
      if (res.ok) {
        // Reload to get updated history
        await load()
      } else {
        setError(result.error ?? 'Unable to generate summary.')
      }
    } catch {
      setError('Unable to generate summary at this time.')
    } finally {
      setGenerating(false)
    }
  }

  function viewHistoryEntry(entry: HistoryEntry) {
    setViewingHistoryId(entry.id)
    setHistoryOpen(false)
  }

  function viewLatest() {
    setViewingHistoryId(null)
    setHistoryOpen(false)
  }

  useEffect(() => { load() }, [load])

  // Determine which summary to display
  const history = data?.history ?? []
  const viewingEntry = viewingHistoryId ? history.find(h => h.id === viewingHistoryId) : null
  const displaySummary = viewingEntry?.summary_text ?? data?.summary
  const displayDate = viewingEntry?.created_at ?? data?.generated_at
  const displayPeriod = viewingEntry?.period_label ?? data?.period_label
  const isViewingOlder = viewingHistoryId !== null && history.length > 0 && viewingHistoryId !== history[0]?.id

  // Loading skeleton
  if (loading) {
    return (
      <div className="rounded-card border bg-card p-5 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Analyst</span>
        </div>
        <div className="animate-pulse space-y-2">
          <div className="h-3 bg-muted rounded w-full" />
          <div className="h-3 bg-muted rounded w-5/6" />
          <div className="h-3 bg-muted rounded w-4/6" />
        </div>
      </div>
    )
  }

  // No summary yet — show generate button
  if (!data?.summary) {
    return (
      <div className="rounded-card border border-dashed bg-card p-5 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Analyst</span>
          </div>
          <div className="flex items-center gap-1">
            {showProviderToggle && (
              <select
                className="h-7 rounded-md border border-input bg-transparent px-2 text-xs text-muted-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value)}
                disabled={generating}
              >
                <option value="anthropic">Claude</option>
                <option value="openai">OpenAI</option>
              </select>
            )}
            <Button size="sm" variant="outline" onClick={generate} disabled={generating} className="text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              {generating ? 'Analyzing…' : 'Analyze'}
            </Button>
          </div>
        </div>
        {generating && (
          <div className="animate-pulse space-y-2 mt-3">
            <div className="h-3 bg-muted rounded w-full" />
            <div className="h-3 bg-muted rounded w-5/6" />
            <div className="h-3 bg-muted rounded w-4/6" />
          </div>
        )}
        {error && (
          <p className="text-sm text-destructive mt-3">{error}</p>
        )}
      </div>
    )
  }

  // Render the summary with paragraph breaks
  const paragraphs = (displaySummary ?? '').split('\n\n').filter(p => p.trim())

  return (
    <div className="rounded-card border bg-card p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Analyst</span>
          {displayDate && (
            <span className="text-[10px] text-muted-foreground">
              · {new Date(displayDate).toLocaleDateString(undefined, {
                month: 'short', day: 'numeric', year: 'numeric',
              })}
            </span>
          )}
          {displayPeriod && (
            <span className="text-[10px] text-muted-foreground">
              · {displayPeriod}
            </span>
          )}
          {isViewingOlder && (
            <button
              onClick={viewLatest}
              className="text-[10px] text-primary hover:underline ml-1"
            >
              Back to latest
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {showProviderToggle && (
            <select
              className="h-7 rounded-md border border-input bg-transparent px-2 text-xs text-muted-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              disabled={generating}
            >
              <option value="anthropic">Claude</option>
              <option value="openai">OpenAI</option>
            </select>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={generate}
            disabled={generating}
            title="Regenerate summary"
            className="h-7 px-2 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${generating ? 'animate-spin' : ''}`} />
          </Button>
          <div className="relative">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setHistoryOpen(!historyOpen)}
              title="View previous summaries"
              className="h-7 px-2 text-muted-foreground hover:text-foreground"
            >
              <History className="h-3.5 w-3.5" />
              <span className="text-[10px] ml-1">{history.length}</span>
            </Button>
            {historyOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-lg border bg-popover shadow-lg">
                <div className="flex items-center justify-between px-3 py-2 border-b">
                  <span className="text-xs font-medium">Summary history</span>
                  <button onClick={() => setHistoryOpen(false)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {history.length <= 1 ? (
                    <p className="px-3 py-4 text-[11px] text-muted-foreground text-center">
                      Each time you analyze this company, a new summary is saved here. Previous summaries are never overwritten.
                    </p>
                  ) : (
                    history.map((entry, i) => (
                      <button
                        key={entry.id}
                        onClick={() => viewHistoryEntry(entry)}
                        className={`w-full text-left px-3 py-2 hover:bg-muted/50 border-b last:border-0 ${ (viewingHistoryId === entry.id || (!viewingHistoryId && i === 0)) ? 'bg-muted/30' : '' }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-foreground">
                            {new Date(entry.created_at).toLocaleDateString(undefined, {
                              month: 'short', day: 'numeric', year: 'numeric',
                            })}
                          </span>
                          {entry.period_label && (
                            <span className="text-[10px] text-muted-foreground">{entry.period_label}</span>
                          )}
                          {i === 0 && (
                            <span className="text-[10px] text-primary font-medium">Latest</span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                          {entry.summary_text.slice(0, 120)}{entry.summary_text.length > 120 ? '…' : ''}
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="space-y-2">
        {paragraphs.map((p, i) => (
          <p key={i} className="text-sm leading-relaxed">{p}</p>
        ))}
      </div>
      {generating && (
        <div className="animate-pulse space-y-2 mt-3 pt-3 border-t">
          <div className="h-3 bg-muted rounded w-full" />
          <div className="h-3 bg-muted rounded w-5/6" />
        </div>
      )}
      {error && (
        <p className="text-sm text-destructive mt-3 pt-3 border-t">{error}</p>
      )}
    </div>
  )
}
