'use client'

import { useEffect, useState, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CompanyForm } from '@/components/company-form'
import { AlertCircle, Check, X, Pencil, Building2, RefreshCw } from 'lucide-react'
import type { Company } from '@/lib/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ISSUE_LABELS: Record<string, string> = {
  new_company_detected: 'New Company',
  low_confidence: 'Low Confidence',
  ambiguous_period: 'Ambiguous Period',
  metric_not_found: 'Metric Not Found',
  company_not_identified: 'Unidentified Company',
  duplicate_period: 'Duplicate Period',
}

const ISSUE_TABS = [
  { key: 'all', label: 'All' },
  { key: 'new_company_detected', label: 'New Company' },
  { key: 'low_confidence', label: 'Low Confidence' },
  { key: 'duplicate_period', label: 'Duplicate' },
  { key: 'ambiguous_period', label: 'Ambiguous Period' },
  { key: 'metric_not_found', label: 'Not Found' },
  { key: 'company_not_identified', label: 'Unidentified' },
]

const STATUS_COLORS: Record<string, string> = {
  new_company_detected: 'bg-blue-100 text-blue-800 border-blue-200',
  low_confidence: 'bg-amber-100 text-amber-800 border-amber-200',
  ambiguous_period: 'bg-orange-100 text-orange-800 border-orange-200',
  metric_not_found: 'bg-slate-100 text-slate-700 border-slate-200',
  company_not_identified: 'bg-red-100 text-red-800 border-red-200',
  duplicate_period: 'bg-purple-100 text-purple-800 border-purple-200',
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReviewPage() {
  const [data, setData] = useState<ReviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState<Record<string, boolean>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [createCompanyFor, setCreateCompanyFor] = useState<ReviewItem | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/review')
      if (!res.ok) throw new Error('Failed to load review queue')
      setData(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function resolve(
    item: ReviewItem,
    resolution: 'accepted' | 'rejected' | 'manually_corrected',
    resolvedValue?: string
  ) {
    setResolving(prev => ({ ...prev, [item.id]: true }))
    try {
      const res = await fetch(`/api/review/${item.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution, resolved_value: resolvedValue }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Failed to resolve')
      }
      // Remove from local list
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
          : prev
      )
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error resolving item')
    } finally {
      setResolving(prev => ({ ...prev, [item.id]: false }))
      setEditingId(null)
    }
  }

  function startEdit(item: ReviewItem) {
    setEditingId(item.id)
    setEditValue(item.extracted_value ?? '')
  }

  function handleCompanyCreated(company: Company) {
    setCreateCompanyFor(null)
    // Resolve the review as rejected (company now exists, user can re-send or wait)
    if (createCompanyFor) {
      resolve(createCompanyFor, 'accepted', company.name)
    }
  }

  const items = data?.items ?? []

  function tabItems(tab: string) {
    return tab === 'all' ? items : items.filter(i => i.issue_type === tab)
  }

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Items flagged by Claude that need human review before values are written.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Summary counts */}
      {data && (
        <div className="grid grid-cols-3 gap-3 mb-6 sm:grid-cols-6">
          {Object.entries(ISSUE_LABELS).map(([key, label]) => (
            <div key={key} className="rounded-lg border bg-card p-3 text-center">
              <p className="text-2xl font-semibold">{data.counts[key] ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{label}</p>
            </div>
          ))}
        </div>
      )}

      {loading && !data && (
        <div className="text-sm text-muted-foreground py-12 text-center">Loading…</div>
      )}

      {data && data.total === 0 && (
        <div className="py-16 text-center">
          <Check className="h-10 w-10 text-green-500 mx-auto mb-3" />
          <p className="font-medium">All clear</p>
          <p className="text-sm text-muted-foreground mt-1">No items need review.</p>
        </div>
      )}

      {data && data.total > 0 && (
        <Tabs defaultValue="all">
          <TabsList className="mb-4 flex-wrap h-auto gap-1">
            {ISSUE_TABS.filter(t => t.key === 'all' || (data.counts[t.key] ?? 0) > 0).map(t => (
              <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
                {t.label}
                {t.key !== 'all' && (
                  <span className="rounded-full bg-muted text-muted-foreground px-1.5 py-0.5 text-[10px] font-mono">
                    {data.counts[t.key]}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {ISSUE_TABS.map(t => (
            <TabsContent key={t.key} value={t.key} className="space-y-3 mt-0">
              {tabItems(t.key).length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No items in this category.
                </p>
              )}
              {tabItems(t.key).map(item => (
                <ReviewCard
                  key={item.id}
                  item={item}
                  resolving={!!resolving[item.id]}
                  editing={editingId === item.id}
                  editValue={editValue}
                  onEditValueChange={setEditValue}
                  onAccept={() => resolve(item, 'accepted')}
                  onReject={() => resolve(item, 'rejected')}
                  onStartEdit={() => startEdit(item)}
                  onCancelEdit={() => setEditingId(null)}
                  onSubmitEdit={() => resolve(item, 'manually_corrected', editValue)}
                  onCreateCompany={() => setCreateCompanyFor(item)}
                />
              ))}
            </TabsContent>
          ))}
        </Tabs>
      )}

      {/* Create Company Dialog */}
      <Dialog
        open={!!createCompanyFor}
        onOpenChange={open => !open && setCreateCompanyFor(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Company</DialogTitle>
          </DialogHeader>
          <CompanyForm
            company={
              createCompanyFor
                ? ({
                    name: createCompanyFor.extracted_value ?? '',
                  } as Company)
                : undefined
            }
            onSuccess={handleCompanyCreated}
            onCancel={() => setCreateCompanyFor(null)}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Review card
// ---------------------------------------------------------------------------

function ReviewCard({
  item,
  resolving,
  editing,
  editValue,
  onEditValueChange,
  onAccept,
  onReject,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onCreateCompany,
}: {
  item: ReviewItem
  resolving: boolean
  editing: boolean
  editValue: string
  onEditValueChange: (v: string) => void
  onAccept: () => void
  onReject: () => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSubmitEdit: () => void
  onCreateCompany: () => void
}) {
  const hasValue = !!item.extracted_value
  const isNewCompany = item.issue_type === 'new_company_detected'
  const isUnidentified = item.issue_type === 'company_not_identified'
  const isMetricNotFound = item.issue_type === 'metric_not_found'

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      {/* Top row: badge + company + metric */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[item.issue_type] ?? ''}`}
        >
          {ISSUE_LABELS[item.issue_type] ?? item.issue_type}
        </span>
        {item.company && (
          <span className="text-sm font-medium">{item.company.name}</span>
        )}
        {!item.company && (
          <span className="text-sm text-muted-foreground italic">Unknown company</span>
        )}
        {item.metric && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-sm text-muted-foreground">{item.metric.name}</span>
          </>
        )}
      </div>

      {/* Extracted value */}
      {hasValue && !editing && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">Value</span>
          <span className="font-mono text-sm bg-muted px-2 py-0.5 rounded">
            {item.extracted_value}
            {item.metric?.unit ? ` ${item.metric.unit}` : ''}
          </span>
        </div>
      )}

      {/* Inline edit */}
      {editing && (
        <div className="flex items-center gap-2">
          <Input
            value={editValue}
            onChange={e => onEditValueChange(e.target.value)}
            className="h-8 w-40 font-mono text-sm"
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') onSubmitEdit()
              if (e.key === 'Escape') onCancelEdit()
            }}
          />
          <Button size="sm" onClick={onSubmitEdit} disabled={resolving || !editValue.trim()}>
            <Check className="h-3.5 w-3.5 mr-1" />
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancelEdit}>
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

      {/* Source email */}
      {item.email && (
        <div className="text-xs text-muted-foreground">
          From{' '}
          <span className="font-medium text-foreground">{item.email.from_address}</span>
          {item.email.subject && (
            <>
              {' · '}
              <a
                href={`/emails/${item.email.id}`}
                className="underline underline-offset-2 hover:text-foreground"
              >
                {item.email.subject}
              </a>
            </>
          )}
          {' · '}
          {new Date(item.email.received_at).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </div>
      )}

      {/* Actions */}
      {!editing && (
        <div className="flex flex-wrap gap-2 pt-1">
          {isNewCompany ? (
            <>
              <Button
                size="sm"
                onClick={onCreateCompany}
                disabled={resolving}
                className="gap-1.5"
              >
                <Building2 className="h-3.5 w-3.5" />
                Create Company
              </Button>
              <Button size="sm" variant="outline" onClick={onReject} disabled={resolving}>
                <X className="h-3.5 w-3.5 mr-1" />
                Dismiss
              </Button>
            </>
          ) : (
            <>
              {!isMetricNotFound && !isUnidentified && hasValue && (
                <Button size="sm" onClick={onAccept} disabled={resolving} className="gap-1.5">
                  <Check className="h-3.5 w-3.5" />
                  Accept
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={onReject}
                disabled={resolving}
                className="gap-1.5"
              >
                <X className="h-3.5 w-3.5" />
                {isMetricNotFound || isUnidentified ? 'Dismiss' : 'Reject'}
              </Button>
              {hasValue && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onStartEdit}
                  disabled={resolving}
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
}
