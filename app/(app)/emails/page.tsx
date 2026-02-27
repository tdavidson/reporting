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
import { AlertCircle, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'

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
    label: 'Needs Review',
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

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Email Log</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every inbound email and its processing result.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(page)} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Status</label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-40 text-sm">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All statuses</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="needs_review">Needs Review</SelectItem>
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
            className="h-8 w-36 text-sm"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">To date</label>
          <Input
            type="date"
            className="h-8 w-36 text-sm"
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
      <div className="rounded-lg border overflow-hidden">
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
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading && !data && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
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
                  {email.company ? (
                    <span>{email.company.name}</span>
                  ) : (
                    <span className="text-muted-foreground italic">Unknown</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={email.processing_status} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {email.metrics_extracted}
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
    </div>
  )
}
