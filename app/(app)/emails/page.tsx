'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
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
import { AlertCircle, RefreshCw, ChevronLeft, ChevronRight, Loader2, Trash2, Copy, Check } from 'lucide-react'
import { FiltersSheet } from '@/components/filters-sheet'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'
import { EmailReviewModal } from '@/components/email-review-modal'

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

interface CompanyOption {
  id: string
  name: string
}

const STATUS_VARIANTS: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  processing: { label: 'Processing', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  success: { label: 'Success', className: 'bg-green-100 text-green-800 border-green-200' },
  not_processed: { label: 'Not processed', className: 'bg-gray-100 text-gray-600 border-gray-200' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-800 border-red-200' },
  needs_review: { label: 'Review', className: 'bg-amber-100 text-amber-800 border-amber-200' },
}

function StatusBadge({ status }: { status: string }) {
  const v = STATUS_VARIANTS[status] ?? { label: status, className: '' }
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${v.className}`}>
      {v.label}
    </span>
  )
}

function fmt(dateStr: string) {
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function EmailsPage() {
  const router = useRouter()
  const [data, setData] = useState<EmailsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [inboundAddress, setInboundAddress] = useState('')
  const [copied, setCopied] = useState(false)

  const [companies, setCompanies] = useState<CompanyOption[]>([])
  useEffect(() => {
    fetch('/api/companies')
      .then(r => r.ok ? r.json() : [])
      .then(d => setCompanies((d?.companies ?? d ?? []).sort((a: CompanyOption, b: CompanyOption) => a.name.localeCompare(b.name))))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/settings').then(r => r.ok ? r.json() : null).then(s => {
      if (s?.postmarkInboundAddress) setInboundAddress(s.postmarkInboundAddress)
    }).catch(() => {})
  }, [])

  const [status, setStatus] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)

  const [reviewModalEmailId, setReviewModalEmailId] = useState<string | null>(null)
  const [dismissing, setDismissing] = useState<Record<string, boolean>>({})

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
      if (companyId) params.set('company_id', companyId)
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
    [status, companyId, dateFrom, dateTo, page]
  )

  useEffect(() => { load(page) }, [load, page])

  const totalPages = data ? Math.ceil(data.total / data.page_size) : 0

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
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
      <div className="mb-6 space-y-1">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Inbound</h1>
          <div className="flex items-center gap-2">
            <div className="lg:hidden">
              <FiltersSheet activeCount={[status, companyId, dateFrom, dateTo].filter(Boolean).length}>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Company</label>
                  <Select value={companyId || 'all'} onValueChange={v => { setCompanyId(v === 'all' ? '' : v); setPage(1) }}>
                    <SelectTrigger className="h-8 w-full text-sm"><SelectValue placeholder="All companies" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All companies</SelectItem>
                      {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Status</label>
                  <Select value={status || 'all'} onValueChange={v => { setStatus(v === 'all' ? '' : v); setPage(1) }}>
                    <SelectTrigger className="h-8 w-full text-sm"><SelectValue placeholder="All statuses" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="success">Success</SelectItem>
                      <SelectItem value="needs_review">Review</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="processing">Processing</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="not_processed">Not processed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">From date</label>
                  <Input type="date" className="h-8 w-full text-sm" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }} />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">To date</label>
                  <Input type="date" className="h-8 w-full text-sm" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }} />
                </div>
                {(status || companyId || dateFrom || dateTo) && (
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => { setStatus(''); setCompanyId(''); setDateFrom(''); setDateTo(''); setPage(1) }}>
                    Clear filters
                  </Button>
                )}
              </FiltersSheet>
            </div>
            <Button variant="outline" size="sm" onClick={() => load(page)} disabled={loading} className="text-muted-foreground">
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <AnalystToggleButton />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">Emails with metrics and updates on portfolio companies</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 w-full">

          {/* Desktop filters */}
          <div className="hidden lg:flex flex-wrap items-end gap-3 mb-5">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Company</label>
              <Select value={companyId || 'all'} onValueChange={v => { setCompanyId(v === 'all' ? '' : v); setPage(1) }}>
                <SelectTrigger className="h-8 w-40 text-sm"><SelectValue placeholder="All companies" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All companies</SelectItem>
                  {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Status</label>
              <Select value={status || 'all'} onValueChange={v => { setStatus(v === 'all' ? '' : v); setPage(1) }}>
                <SelectTrigger className="h-8 w-40 text-sm"><SelectValue placeholder="All statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="needs_review">Review</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="not_processed">Not processed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">From date</label>
              <Input type="date" className="h-8 w-36 text-sm" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }} />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">To date</label>
              <Input type="date" className="h-8 w-36 text-sm" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }} />
            </div>
            {(status || companyId || dateFrom || dateTo) && (
              <Button size="sm" variant="ghost" className="h-8" onClick={() => { setStatus(''); setCompanyId(''); setDateFrom(''); setDateTo(''); setPage(1) }}>
                Clear
              </Button>
            )}
            {inboundAddress && (
              <div className="ml-auto flex items-end gap-1.5">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Send emails to</label>
                  <Input type="text" readOnly value={inboundAddress} className="h-8 w-64 text-sm bg-muted text-muted-foreground cursor-default" tabIndex={-1} />
                </div>
                <button
                  onClick={() => { navigator.clipboard.writeText(inboundAddress); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                  className="h-8 px-2 text-muted-foreground hover:text-foreground transition-colors"
                  title="Copy to clipboard"
                >
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            )}
          </div>

          {/* Mobile inbound address */}
          {inboundAddress && (
            <div className="flex items-end gap-1.5 mb-5 lg:hidden">
              <Input type="text" readOnly value={inboundAddress} className="h-8 w-full text-sm bg-muted text-muted-foreground cursor-default" tabIndex={-1} />
              <button
                onClick={() => { navigator.clipboard.writeText(inboundAddress); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                className="h-8 px-2 text-muted-foreground hover:text-foreground transition-colors"
                title="Copy to clipboard"
              >
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          )}

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
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell w-40">Received</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground w-32">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground w-36">Company</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">From</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Subject</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell w-20">Metrics</th>
                  <th className="px-4 py-3 w-10"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading && !data && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">Loading…</td>
                  </tr>
                )}
                {!loading && data?.items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No emails found.</td>
                  </tr>
                )}
                {data?.items.map(email => (
                  <tr
                    key={email.id}
                    className="hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => router.push(`/emails/${email.id}`)}
                  >
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap hidden sm:table-cell">
                      {fmt(email.received_at)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={email.processing_status} />
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const needsSetup = email.processing_status === 'needs_review' &&
                          (!email.company || email.company_metrics_count === 0)
                        if (needsSetup) {
                          return (
                            <button
                              className="text-amber-600 hover:text-amber-700 font-medium text-sm underline underline-offset-2"
                              onClick={(e) => { e.stopPropagation(); setReviewModalEmailId(email.id) }}
                            >
                              {email.company ? `${email.company.name} · Setup` : 'Unknown'}
                            </button>
                          )
                        }
                        if (!email.company) {
                          return (
                            <button
                              className="text-muted-foreground hover:text-foreground italic text-sm underline underline-offset-2"
                              onClick={(e) => { e.stopPropagation(); setReviewModalEmailId(email.id) }}
                            >
                              Unknown
                            </button>
                          )
                        }
                        return <span>{email.company.name}</span>
                      })()}
                    </td>
                    <td className="px-4 py-3 max-w-[180px] truncate">{email.from_address}</td>
                    <td className="px-4 py-3 max-w-[240px] truncate text-muted-foreground hidden md:table-cell">
                      {email.subject ?? <span className="italic">(no subject)</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell">
                      {email.metrics_extracted}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {email.processing_status === 'needs_review' && (
                        <button
                          className="text-muted-foreground hover:text-destructive disabled:opacity-50 p-1"
                          disabled={!!dismissing[email.id]}
                          onClick={(e) => { e.stopPropagation(); dismissReviews(email.id) }}
                        >
                          {dismissing[email.id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
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
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
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
        <AnalystPanel />
      </div>
    </div>
  )
}
