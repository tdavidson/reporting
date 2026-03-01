'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, RefreshCw, ChevronLeft, ChevronRight, HardDrive, Check, Loader2, Trash2 } from 'lucide-react'
import { EmailReviewModal } from '@/components/email-review-modal'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmailRow {
  id: string
  from_address: string
  subject: string | null
  received_at: string
  processing_status: string
  metrics_extracted: number
  company: { id: string; name: string } | null
  company_metrics_count: number
}

interface EmailsData {
  total: number
  page: number
  page_size: number
  items: EmailRow[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_VARIANTS: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  processing: { label: 'Processing', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  success: { label: 'Success', className: 'bg-green-100 text-green-800 border-green-200' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-800 border-red-200' },
  needs_review: {
    label: 'Review',
    className: 'bg-amber-100 text-amber-800 border-amber-200',
  },
}

function StatusBadge({ status }: { status: string }) {
  const v = STATUS_VARIANTS[status] ?? { label: status, className: '' }
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${v.className}`}
    >
      {v.label}
    </span>
  )
}

function fmt(dateStr: string) {
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EmailsPage() {
  const router = useRouter()
  const [data, setData] = useState<EmailsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [status, setStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)

  // Review modal
  const [reviewModalEmailId, setReviewModalEmailId] = useState<string | null>(null)
  const [dismissing, setDismissing] = useState<Record<string, boolean>>({})

  // Bulk save to drive
  const [savingToDrive, setSavingToDrive] = useState(false)
  const [driveResult, setDriveResult] = useState<{ saved: number; failed: number } | null>(null)
  const [driveError, setDriveError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(
    async (p = page) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setLoading(true)
      setError(null)

      const params = new URLSearchParams({ page: String(p) })
      if (status) params.set('status', status)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)

      try {
        const res = await fetch(`/api/emails?${params}`, { signal: controller.signal })
        if (!res.ok) throw new Error('Failed to load emails')
        setData(await res.json())
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : 'Error loading data')
        }
      } finally {
        setLoading(false)
      }
    },
    [status, dateFrom, dateTo, page]
  )

  useEffect(() => {
    load(page)
  }, [load, page])

  function applyFilters() {
    setPage(1)
    load(1)
  }

  function clearFilters() {
    setStatus('')
    setDateFrom('')
    setDateTo('')
    setPage(1)
  }

  const totalPages = data ? Math.ceil(data.total / data.page_size) : 0

  async function saveAllToDrive() {
    if (!confirm('Save all processed emails and their attachments to Google Drive?')) return
    setSavingToDrive(true)
    setDriveResult(null)
    setDriveError(null)

    try {
      // Fetch all email IDs with company assigned (successfully processed)
      const params = new URLSearchParams({ page: '1', page_size: '1000' })
      const listRes = await fetch(`/api/emails?${params}`)
      if (!listRes.ok) throw new Error('Failed to fetch emails')
      const listData = await listRes.json() as EmailsData
      const emailIds = listData.items
        .filter(e => e.company !== null)
        .map(e => e.id)

      if (emailIds.length === 0) {
        setDriveError('No processed emails with identified companies to save')
        setSavingToDrive(false)
        return
      }

      const res = await fetch('/api/emails/save-to-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailIds }),
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? 'Failed to save')
      setDriveResult({ saved: result.saved, failed: result.failed })
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : 'Failed to save to Drive')
    } finally {
      setSavingToDrive(false)
    }
  }

  async function dismissReviews(emailId: string) {
    setDismissing(prev => ({ ...prev, [emailId]: true }))
    try {
      const res = await fetch(`/api/emails/${emailId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss_all' }),
      })
      if (res.ok) load(page)
    } catch {
      // ignore
    } finally {
      setDismissing(prev => ({ ...prev, [emailId]: false }))
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Email Log</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every inbound email and its processing result.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={saveAllToDrive}
            disabled={savingToDrive || !data?.items.length}
          >
            {savingToDrive ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : driveResult && driveResult.failed === 0 ? (
              <Check className="h-4 w-4 mr-2" />
            ) : (
              <HardDrive className="h-4 w-4 mr-2" />
            )}
            {savingToDrive
              ? 'Saving…'
              : driveResult
                ? `${driveResult.saved} saved`
                : 'Save all to Drive'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => load(page)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {driveError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{driveError}</AlertDescription>
        </Alert>
      )}

      {driveResult && driveResult.failed > 0 && (
        <Alert className="mb-4">
          <AlertDescription>
            Saved {driveResult.saved} email{driveResult.saved !== 1 ? 's' : ''} to Drive.
            {driveResult.failed} failed.
          </AlertDescription>
        </Alert>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Status</label>
          <Select value={status || 'all'} onValueChange={v => setStatus(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 w-full sm:w-40 text-sm">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="needs_review">Review</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">From date</label>
          <Input
            type="date"
            className="h-8 w-full sm:w-36 text-sm"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">To date</label>
          <Input
            type="date"
            className="h-8 w-full sm:w-36 text-sm"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
          />
        </div>
        <Button size="sm" className="h-8" onClick={applyFilters}>
          Apply
        </Button>
        {(status || dateFrom || dateTo) && (
          <Button size="sm" variant="ghost" className="h-8" onClick={clearFilters}>
            Clear
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Table */}
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground w-40">
                Received
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">From</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Subject</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground w-36">
                Company
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground w-32">
                Status
              </th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground w-20">
                Metrics
              </th>
              <th className="px-4 py-3 w-10">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading && !data && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  No emails found.
                </td>
              </tr>
            )}
            {data?.items.map(email => (
              <tr
                key={email.id}
                className="hover:bg-muted/30 cursor-pointer transition-colors"
                onClick={() => router.push(`/emails/${email.id}`)}
              >
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                  {fmt(email.received_at)}
                </td>
                <td className="px-4 py-3 max-w-[180px] truncate">{email.from_address}</td>
                <td className="px-4 py-3 max-w-[240px] truncate text-muted-foreground">
                  {email.subject ?? <span className="italic">(no subject)</span>}
                </td>
                <td className="px-4 py-3">
                  {(() => {
                    const needsSetup = email.processing_status === 'needs_review' &&
                      (!email.company || email.company_metrics_count === 0)
                    if (needsSetup) {
                      return (
                        <button
                          className="text-amber-600 hover:text-amber-700 font-medium text-sm underline underline-offset-2"
                          onClick={(e) => {
                            e.stopPropagation()
                            setReviewModalEmailId(email.id)
                          }}
                        >
                          {email.company ? `${email.company.name} · Setup` : 'Unknown'}
                        </button>
                      )
                    }
                    return email.company
                      ? <span>{email.company.name}</span>
                      : <span className="text-muted-foreground italic">Unknown</span>
                  })()}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={email.processing_status} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {email.metrics_extracted}
                </td>
                <td className="px-4 py-3 text-center">
                  {email.processing_status === 'needs_review' && (
                    <button
                      className="text-muted-foreground hover:text-destructive disabled:opacity-50 p-1"
                      disabled={!!dismissing[email.id]}
                      onClick={(e) => {
                        e.stopPropagation()
                        dismissReviews(email.id)
                      }}
                    >
                      {dismissing[email.id] ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-muted-foreground">
            {data.total} email{data.total !== 1 ? 's' : ''} · page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <EmailReviewModal
        emailId={reviewModalEmailId}
        open={!!reviewModalEmailId}
        onOpenChange={(open) => { if (!open) { setReviewModalEmailId(null); load(page) } }}
      />
    </div>
  )
}
