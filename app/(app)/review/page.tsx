'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Check, X, Pencil, Loader2 } from 'lucide-react'

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

interface ReviewData {
  total: number
  counts: Record<string, number>
  items: ReviewItem[]
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
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Review</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Items that need your attention — metrics Claude wasn&apos;t sure about, unidentified companies, and more.
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && items.length === 0 && (
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
    </div>
  )
}
