'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Check, X, Pencil, Loader2, Mail } from 'lucide-react'
import { EmailReviewModal } from '@/components/email-review-modal'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'

interface ReviewItem {
  id: string
  issue_type: string
  extracted_value: string | null
  context_snippet: string | null
  created_at: string
  company: { id: string; name: string } | null
  metric: { id: string; name: string; unit: string | null; value_type: string } | null
  email: { id: string; subject: string | null; received_at: string; from_address: string } | null
}

interface NeedsReviewEmail {
  id: string
  from_address: string
  subject: string | null
  received_at: string
  company: { id: string; name: string } | null
}

interface ReviewData {
type FeedItem =
  | { type: 'email'; id: string; date: string; subject: string | null; from: string; metricsExtracted: number; company: { id: string; name: string } | null }
  | { type: 'interaction'; id: string; date: string; subject: string | null; summary: string | null; tags: string[]; company: { id: string; name: string } | null }

interface ReviewData {
  total: number
  counts: Record<string, number>
  items: ReviewItem[]
  needsReviewEmails: NeedsReviewEmail[]
  feed: FeedItem[]
}

const ISSUE_LABELS: Record<string, string> = {
  new_company_detected: 'New Company',
  low_confidence: 'Low Confidence',
  ambiguous_period: 'Ambiguous Period',
  metric_not_found: 'Metric Not Found',
  company_not_identified: 'Unidentified Company',
  duplicate_period: 'Duplicate Period',
}

const STATUS_COLORS: Record<string, string> = {
  new_company_detected: 'bg-blue-100 text-blue-800 border-blue-200',
  low_confidence: 'bg-amber-100 text-amber-800 border-amber-200',
  ambiguous_period: 'bg-orange-100 text-orange-800 border-orange-200',
  metric_not_found: 'bg-slate-100 text-slate-700 border-slate-200',
  company_not_identified: 'bg-red-100 text-red-800 border-red-200',
  duplicate_period: 'bg-purple-100 text-purple-800 border-purple-200',
}

export default function ReviewPage() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ReviewData | null>(null)
  const [resolving, setResolving] = useState<Record<string, boolean>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [reviewModalEmailId, setReviewModalEmailId] = useState<string | null>(null)
  const [limit, setLimit] = useState(20)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/review')
      if (!res.ok) throw new Error('Failed to load')
      setData(await res.json())
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function resolve(
    item: ReviewItem,
    resolution: 'accepted' | 'rejected' | 'manually_corrected',
    resolvedValue?: string,
  ) {
    setResolving(prev => ({ ...prev, [item.id]: true }))
    try {
      const res = await fetch(`/api/review/${item.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution, resolved_value: resolvedValue }),
      })
      if (!res.ok) throw new Error('Failed to resolve')
      setData(prev =>
        prev
          ? {
              ...prev,
              total: prev.total - 1,
              counts: {
                ...prev.counts,
                [item.issue_type]: (prev.counts[item.issue_type] ?? 1) - 1,
              },
              items: prev.items.filter(i => i.id !== item.id),
            }
          : prev,
      )
    } catch {
      // ignore
    } finally {
      setResolving(prev => ({ ...prev, [item.id]: false }))
      setEditingId(null)
    }
  }

  const items = data?.items ?? []

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Items that need your attention — metrics AI wasn&apos;t sure about, unidentified companies, and more.
          </p>
        </div>
        <AnalystToggleButton />
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
      <div className="flex-1 min-w-0 max-w-4xl w-full">
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && items.length === 0 && (data?.needsReviewEmails ?? []).length === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">All clear — nothing to review.</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-3">
          {items.map(item => {
            const isEditing = editingId === item.id
            const isResolving = !!resolving[item.id]
            const hasValue = !!item.extracted_value

            return (
              <div key={item.id} className="rounded-lg border bg-card p-4 space-y-3">
                {/* Header row */}
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[item.issue_type] ?? ''}`}
                  >
                    {ISSUE_LABELS[item.issue_type] ?? item.issue_type}
                  </span>
                  {item.company && (
                    <Link
                      href={`/companies/${item.company.id}`}
                      className="text-sm font-medium hover:underline"
                      onClick={e => e.stopPropagation()}
                    >
                      {item.company.name}
                    </Link>
                  )}
                  {item.metric && (
                    <>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-sm text-muted-foreground">{item.metric.name}</span>
                    </>
                  )}
                  {item.email && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {item.email.subject ?? '(no subject)'} — {new Date(item.email.received_at).toLocaleDateString()}
                    </span>
                  )}
                </div>

                {/* Extracted value */}
                {hasValue && !isEditing && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Value</span>
                    <span className="font-mono text-sm bg-muted px-2 py-0.5 rounded">
                      {item.extracted_value}
                      {item.metric?.unit ? ` ${item.metric.unit}` : ''}
                    </span>
                  </div>
                )}

                {/* Inline edit */}
                {isEditing && (
                  <div className="flex items-center gap-2">
                    <Input
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      className="h-8 w-40 font-mono text-sm"
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter') resolve(item, 'manually_corrected', editValue)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                    />
                    <Button
                      size="sm"
                      onClick={() => resolve(item, 'manually_corrected', editValue)}
                      disabled={isResolving || !editValue.trim()}
                    >
                      <Check className="h-3.5 w-3.5 mr-1" />
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                )}

                {/* Context snippet */}
                {item.context_snippet && (
                  <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground italic leading-relaxed">
                    {item.context_snippet}
                  </blockquote>
                )}

                {/* Actions */}
                {!isEditing && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {item.issue_type === 'new_company_detected' || item.issue_type === 'company_not_identified' ? (
                      <Button size="sm" variant="outline" onClick={() => resolve(item, 'rejected')} disabled={isResolving} className="gap-1.5">
                        <X className="h-3.5 w-3.5" />
                        Dismiss
                      </Button>
                    ) : (
                      <>
                        {item.issue_type !== 'metric_not_found' && hasValue && (
                          <Button size="sm" onClick={() => resolve(item, 'accepted')} disabled={isResolving} className="gap-1.5">
                            <Check className="h-3.5 w-3.5" />
                            Accept
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => resolve(item, 'rejected')} disabled={isResolving} className="gap-1.5">
                          <X className="h-3.5 w-3.5" />
                          {item.issue_type === 'metric_not_found' ? 'Dismiss' : 'Reject'}
                        </Button>
                        {hasValue && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingId(item.id)
                              setEditValue(item.extracted_value ?? '')
                            }}
                            disabled={isResolving}
                            className="gap-1.5"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit &amp; Accept
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!loading && (data?.needsReviewEmails ?? []).length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">
            Emails needing review ({data!.needsReviewEmails.length})
          </h2>
          <div className="space-y-2">
            {data!.needsReviewEmails.map(email => (
              <button
                key={email.id}
                onClick={() => setReviewModalEmailId(email.id)}
                className="w-full rounded-lg border bg-card p-4 text-left hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-amber-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {email.subject || '(no subject)'}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span>{email.from_address}</span>
                      <span>{new Date(email.received_at).toLocaleDateString()}</span>
                      {email.company ? (
                        <span>{email.company.name}</span>
                      ) : (
                        <span className="text-amber-600">No company assigned</span>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200 shrink-0">
                    Needs Review
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <EmailReviewModal
        emailId={reviewModalEmailId}
        open={!!reviewModalEmailId}
        onOpenChange={(open) => {
          if (!open) {
            setReviewModalEmailId(null)
            load()
          }
        }}
      />
        {!loading && (data?.feed ?? []).length > 0 && (
  <div className="mt-8">
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-medium text-muted-foreground">Activity feed</h2>
      <div className="flex items-center gap-1 text-xs border rounded-md overflow-hidden">
        {[20, 50, 100].map(n => (
          <button
            key={n}
            onClick={() => setLimit(n)}
            className={`px-2.5 py-1 transition-colors ${limit === n ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
    <div className="space-y-2">
      {data!.feed.slice(0, limit).map(item => (
        <div key={item.id} className="rounded-lg border bg-card p-3 flex items-start gap-3">
          <div className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${item.type === 'email' ? 'bg-emerald-500' : 'bg-blue-500'}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium">
                {item.type === 'email' ? 'Email processado' : 'Interaction criada'}
              </span>
              {item.company && (
                <Link href={`/companies/${item.company.id}`} className="text-xs text-muted-foreground hover:underline">
                  {item.company.name}
                </Link>
              )}
              {item.type === 'email' && item.metricsExtracted > 0 && (
                <span className="text-xs text-muted-foreground">{item.metricsExtracted} métrica{item.metricsExtracted !== 1 ? 's' : ''}</span>
              )}
              <span className="text-xs text-muted-foreground ml-auto">{new Date(item.date).toLocaleDateString('pt-BR')}</span>
            </div>
            {item.subject && (
              <p className="text-sm text-muted-foreground truncate mt-0.5">{item.subject}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  </div>
)}
    </div>
    <AnalystPanel />
    </div>
    </div>
  )
}
