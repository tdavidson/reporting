'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CompanyForm } from '@/components/company-form'
import { MetricForm } from '@/components/metric-form'
import { Check, X, Pencil, Building2, Loader2, Plus, BarChart3, RefreshCw, Mail } from 'lucide-react'
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

interface EmailInfo {
  id: string
  subject: string | null
  from_address: string
  received_at: string
  company: { id: string; name: string } | null
}

interface MetricInfo {
  id: string
  name: string
  slug: string
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

const STATUS_COLORS: Record<string, string> = {
  new_company_detected: 'bg-blue-100 text-blue-800 border-blue-200',
  low_confidence: 'bg-amber-100 text-amber-800 border-amber-200',
  ambiguous_period: 'bg-orange-100 text-orange-800 border-orange-200',
  metric_not_found: 'bg-slate-100 text-slate-700 border-slate-200',
  company_not_identified: 'bg-red-100 text-red-800 border-red-200',
  duplicate_period: 'bg-purple-100 text-purple-800 border-purple-200',
}

// ---------------------------------------------------------------------------
// EmailReviewModal
// ---------------------------------------------------------------------------

export function EmailReviewModal({
  emailId,
  open,
  onOpenChange,
}: {
  emailId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [loading, setLoading] = useState(false)
  const [emailInfo, setEmailInfo] = useState<EmailInfo | null>(null)
  const [metrics, setMetrics] = useState<MetricInfo[]>([])
  const [reviewData, setReviewData] = useState<ReviewData | null>(null)
  const [resolving, setResolving] = useState<Record<string, boolean>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  // Company selector state
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [assigningCompany, setAssigningCompany] = useState(false)

  // Reprocess state
  const [reprocessing, setReprocessing] = useState(false)
  const [reprocessSuccess, setReprocessSuccess] = useState(false)

  // Section expand states
  const [showCompanyForm, setShowCompanyForm] = useState(false)
  const [showMetricForm, setShowMetricForm] = useState(false)
  const [metricsAdded, setMetricsAdded] = useState(0)

  // Extract company name hint from review items (for new_company_detected)
  const companyNameHint = reviewData?.items.find(
    i => i.issue_type === 'new_company_detected' || i.issue_type === 'company_not_identified'
  )?.extracted_value ?? ''

  const loadAll = useCallback(async () => {
    if (!emailId) return
    setLoading(true)
    try {
      // Fetch email info, reviews, and companies list in parallel
      const [emailRes, reviewsRes, companiesRes] = await Promise.all([
        fetch(`/api/emails/${emailId}`),
        fetch(`/api/emails/${emailId}/reviews`),
        fetch('/api/companies'),
      ])

      if (!emailRes.ok) throw new Error('Failed to load email')
      if (!reviewsRes.ok) throw new Error('Failed to load reviews')

      const emailData = await emailRes.json()
      const reviewsResult: ReviewData = await reviewsRes.json()

      // Load companies for the selector
      if (companiesRes.ok) {
        const companiesData = await companiesRes.json()
        setCompanies(
          (companiesData as { id: string; name: string; status: string }[])
            .filter(c => c.status === 'active')
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      }

      const info: EmailInfo = {
        id: emailData.id,
        subject: emailData.subject ?? null,
        from_address: emailData.from_address ?? '',
        received_at: emailData.received_at ?? '',
        company: emailData.company ?? null,
      }
      setEmailInfo(info)
      setReviewData(reviewsResult)

      // If company exists, fetch its metrics
      if (info.company) {
        await loadMetrics(info.company.id)
      } else {
        setMetrics([])
      }
    } catch {
      setEmailInfo(null)
      setReviewData(null)
      setMetrics([])
    } finally {
      setLoading(false)
    }
  }, [emailId])

  async function loadMetrics(companyId: string) {
    try {
      const res = await fetch(`/api/companies/${companyId}/metrics`)
      if (res.ok) {
        const data = await res.json()
        setMetrics((data as MetricInfo[]).map(m => ({ id: m.id, name: m.name, slug: m.slug })))
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (open && emailId) {
      loadAll()
      setShowCompanyForm(false)
      setShowMetricForm(false)
      setMetricsAdded(0)
      setEditingId(null)
      setSelectedCompanyId('')
      setAssigningCompany(false)
      setReprocessing(false)
      setReprocessSuccess(false)
    } else {
      setEmailInfo(null)
      setReviewData(null)
      setMetrics([])
      setCompanies([])
      setShowCompanyForm(false)
      setShowMetricForm(false)
      setMetricsAdded(0)
      setEditingId(null)
      setSelectedCompanyId('')
      setAssigningCompany(false)
      setReprocessing(false)
      setReprocessSuccess(false)
    }
  }, [open, emailId, loadAll])

  // Auto-show metric form when company exists but no metrics
  useEffect(() => {
    if (!loading && emailInfo) {
      if (emailInfo.company && metrics.length === 0) {
        setShowMetricForm(true)
      }
    }
  }, [loading, emailInfo, metrics.length])

  async function handleCompanyCreated(company: Company) {
    // Link the email to the new company
    if (emailId) {
      await fetch(`/api/emails/${emailId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: company.id }),
      })
    }

    // Auto-resolve any new_company_detected or company_not_identified reviews
    const companyReviews = reviewData?.items.filter(
      i => i.issue_type === 'new_company_detected' || i.issue_type === 'company_not_identified'
    ) ?? []
    for (const item of companyReviews) {
      try {
        await fetch(`/api/review/${item.id}/resolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resolution: 'accepted', resolved_value: company.name }),
        })
      } catch {
        // ignore
      }
    }

    // Update local state
    setEmailInfo(prev => prev ? { ...prev, company: { id: company.id, name: company.name } } : prev)
    setShowCompanyForm(false)
    setShowMetricForm(true)

    // Remove resolved review items from local state
    const resolvedIds = new Set(companyReviews.map(i => i.id))
    setReviewData(prev => prev ? {
      ...prev,
      total: prev.total - resolvedIds.size,
      items: prev.items.filter(i => !resolvedIds.has(i.id)),
    } : prev)

    // Load metrics for the new company
    await loadMetrics(company.id)
  }

  function handleMetricAdded() {
    setMetricsAdded(prev => prev + 1)
    // Refresh metrics list
    if (emailInfo?.company) {
      loadMetrics(emailInfo.company.id)
    }
  }

  async function handleAssignCompany() {
    if (!selectedCompanyId || !emailId) return
    setAssigningCompany(true)
    try {
      const res = await fetch(`/api/emails/${emailId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: selectedCompanyId }),
      })
      if (!res.ok) throw new Error('Failed to assign company')

      const company = companies.find(c => c.id === selectedCompanyId)
      if (!company) return

      // Auto-resolve company-related reviews
      const companyReviews = reviewData?.items.filter(
        i => i.issue_type === 'new_company_detected' || i.issue_type === 'company_not_identified'
      ) ?? []
      for (const item of companyReviews) {
        try {
          await fetch(`/api/review/${item.id}/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resolution: 'accepted', resolved_value: company.name }),
          })
        } catch {
          // ignore
        }
      }

      // Update local state
      setEmailInfo(prev => prev ? { ...prev, company: { id: company.id, name: company.name } } : prev)
      setSelectedCompanyId('')

      // Remove resolved review items
      const resolvedIds = new Set(companyReviews.map(i => i.id))
      setReviewData(prev => prev ? {
        ...prev,
        total: prev.total - resolvedIds.size,
        items: prev.items.filter(i => !resolvedIds.has(i.id)),
      } : prev)

      // Load metrics for the assigned company
      await loadMetrics(company.id)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error assigning company')
    } finally {
      setAssigningCompany(false)
    }
  }

  async function handleReprocess() {
    if (!emailId) return
    setReprocessing(true)
    setReprocessSuccess(false)
    try {
      const res = await fetch(`/api/emails/${emailId}/reprocess`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Failed to reprocess')
      }
      setReprocessSuccess(true)
      // Refresh modal data after a short delay to let pipeline start
      setTimeout(() => {
        loadAll()
      }, 1500)
      // Close modal and refresh parent after pipeline has started
      setTimeout(() => {
        onOpenChange(false)
      }, 2500)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error reprocessing email')
    } finally {
      setReprocessing(false)
    }
  }

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
      setReviewData(prev =>
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

  const hasCompany = !!emailInfo?.company
  const hasMetrics = metrics.length > 0
  const items = reviewData?.items ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Email Setup & Review</DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && emailInfo && (
          <div className="space-y-5">
            {/* ── Email Context ── */}
            <section className="rounded-lg border bg-muted/30 p-4">
              <div className="flex items-start gap-3">
                <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium leading-snug">
                    {emailInfo.subject || '(no subject)'}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>From: {emailInfo.from_address}</span>
                    {emailInfo.received_at && (
                      <span>{new Date(emailInfo.received_at).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* ── Section 1: Review Items ── */}
            {items.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-medium">Review Items</h3>
                  <span className="text-xs text-muted-foreground">
                    {items.length} pending
                  </span>
                </div>

                <div className="space-y-3">
                  {items.map(item => (
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
                    />
                  ))}
                </div>
              </section>
            )}

            {/* ── Section 2: Company ── */}
            <section>
              <div className="flex items-center gap-2 mb-2">
                <div className={`flex items-center justify-center h-5 w-5 rounded-full ${hasCompany ? 'bg-green-100' : 'bg-slate-100'}`}>
                  {hasCompany ? (
                    <Check className="h-3 w-3 text-green-600" />
                  ) : (
                    <Building2 className="h-3 w-3 text-slate-400" />
                  )}
                </div>
                <h3 className="text-sm font-medium">Company</h3>
                {hasCompany && (
                  <span className="text-sm text-muted-foreground">{emailInfo.company!.name}</span>
                )}
              </div>

              {!hasCompany && !showCompanyForm && (
                <div className="ml-7 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    No company assigned. Select an existing company or create a new one.
                  </p>

                  {/* Select existing company */}
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedCompanyId}
                      onChange={e => setSelectedCompanyId(e.target.value)}
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 flex-1"
                    >
                      <option value="">Select a company…</option>
                      {companies.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      onClick={handleAssignCompany}
                      disabled={!selectedCompanyId || assigningCompany}
                      className="gap-1.5"
                    >
                      {assigningCompany ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Assign
                    </Button>
                  </div>

                  {/* Or create new */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="h-px flex-1 bg-border" />
                    <span>or</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowCompanyForm(true)}
                    className="gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create New Company
                  </Button>
                </div>
              )}

              {!hasCompany && showCompanyForm && (
                <div className="ml-7 rounded-lg border bg-muted/30 p-4">
                  <CompanyForm
                    initialName={companyNameHint}
                    onSuccess={handleCompanyCreated}
                    onCancel={() => setShowCompanyForm(false)}
                  />
                </div>
              )}
            </section>

            {/* ── Section 3: Metrics ── */}
            {hasCompany && (
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <div className={`flex items-center justify-center h-5 w-5 rounded-full ${hasMetrics ? 'bg-green-100' : 'bg-slate-100'}`}>
                    {hasMetrics ? (
                      <Check className="h-3 w-3 text-green-600" />
                    ) : (
                      <BarChart3 className="h-3 w-3 text-slate-400" />
                    )}
                  </div>
                  <h3 className="text-sm font-medium">Metrics</h3>
                  {hasMetrics && (
                    <span className="text-sm text-muted-foreground">
                      {metrics.length} configured
                    </span>
                  )}
                </div>

                {/* Show existing metrics as compact list */}
                {hasMetrics && (
                  <div className="ml-7 mb-2">
                    <div className="flex flex-wrap gap-1.5">
                      {metrics.map(m => (
                        <span
                          key={m.id}
                          className="inline-flex items-center rounded-md border bg-muted/50 px-2 py-0.5 text-xs"
                        >
                          {m.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {showMetricForm && (
                  <div className="ml-7 rounded-lg border bg-muted/30 p-4">
                    {!hasMetrics && (
                      <p className="text-xs text-muted-foreground mb-3">
                        No metrics configured. Add at least one so Claude knows what to extract.
                      </p>
                    )}
                    {metricsAdded > 0 && (
                      <p className="text-xs text-emerald-600 flex items-center gap-1 mb-3">
                        <Check className="h-3 w-3" />
                        {metricsAdded} metric{metricsAdded !== 1 ? 's' : ''} added
                      </p>
                    )}
                    <MetricForm
                      key={metricsAdded}
                      companyId={emailInfo.company!.id}
                      onSuccess={handleMetricAdded}
                      onCancel={() => setShowMetricForm(false)}
                    />
                  </div>
                )}

                {!showMetricForm && (
                  <div className="ml-7">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowMetricForm(true)}
                      className="gap-1.5"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Metric
                    </Button>
                  </div>
                )}
              </section>
            )}

            {/* ── Section 4: Reprocess Email ── */}
            {hasCompany && (
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <div className={`flex items-center justify-center h-5 w-5 rounded-full ${reprocessSuccess ? 'bg-green-100' : 'bg-slate-100'}`}>
                    {reprocessSuccess ? (
                      <Check className="h-3 w-3 text-green-600" />
                    ) : (
                      <RefreshCw className="h-3 w-3 text-slate-400" />
                    )}
                  </div>
                  <h3 className="text-sm font-medium">Reprocess Email</h3>
                </div>

                <div className="ml-7">
                  {reprocessSuccess ? (
                    <p className="text-sm text-emerald-600 flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5" />
                      Reprocessing started. Modal will close shortly.
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground mb-3">
                        Run the email through the AI pipeline to extract metric values.
                      </p>
                      <Button
                        size="sm"
                        onClick={handleReprocess}
                        disabled={reprocessing}
                        className="gap-1.5"
                      >
                        {reprocessing ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        {reprocessing ? 'Reprocessing…' : 'Reprocess Email'}
                      </Button>
                    </>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// ReviewCard
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

      {/* Actions */}
      {!editing && (
        <div className="flex flex-wrap gap-2 pt-1">
          {/* new_company_detected and company_not_identified are handled by the Company section above */}
          {isNewCompany || isUnidentified ? (
            <Button size="sm" variant="outline" onClick={onReject} disabled={resolving} className="gap-1.5">
              <X className="h-3.5 w-3.5" />
              Dismiss
            </Button>
          ) : (
            <>
              {!isMetricNotFound && hasValue && (
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
                {isMetricNotFound ? 'Dismiss' : 'Reject'}
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
