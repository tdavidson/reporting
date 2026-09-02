'use client'

import { useEffect, useState, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'
import { EmptyState } from '@/components/ui/empty-state'

interface PreviewResult {
  summary: string
  details: Record<string, unknown>
}
/** The shared service's DTO (lib/pending-actions/service.ts), which is camelCase. */
interface PendingActionRow {
  id: string
  domain: string
  actionType: string
  preview: PreviewResult
  createdAt: string
  createdVia: string | null
}

const ACTION_LABELS: Record<string, string> = {
  update_company_metric: 'Metric update',
  record_investment: 'Investment',
  issue_capital_call: 'Capital call',
}

function formatVal(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'number') return v.toLocaleString()
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export default function PendingActionsPage() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<PendingActionRow[]>([])
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // The queue is paginated now that it goes through the shared service. Nothing about this
      // page is a page-at-a-time experience — it is a to-do list — so walk the cursor to the end.
      const collected: PendingActionRow[] = []
      let cursor: string | null = null
      do {
        const res: Response = await fetch(`/api/pending-actions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)
        if (!res.ok) throw new Error('Failed to load')
        const page: { actions: PendingActionRow[]; nextCursor: string | null } = await res.json()
        collected.push(...page.actions)
        cursor = page.nextCursor
      } while (cursor)
      setRows(collected)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function act(row: PendingActionRow, kind: 'approve' | 'reject') {
    setBusy(prev => ({ ...prev, [row.id]: true }))
    setError(null)
    try {
      const res = await fetch(`/api/pending-actions/${row.id}/${kind}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) {
        setError(data.error ?? `Could not ${kind}`)
        return
      }
      // Optimistically drop the row — it left the pending queue.
      setRows(prev => prev.filter(r => r.id !== row.id))
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(prev => ({ ...prev, [row.id]: false }))
    }
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pending Actions</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Changes the Analyst drafted, waiting on your approval. Nothing here has taken effect —
            approving runs the same write the direct tools do.
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

          {!loading && rows.length === 0 && (
            <EmptyState>Nothing pending. Drafts you stage in the Analyst show up here.</EmptyState>
          )}

          {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

          {!loading && rows.length > 0 && (
            <div className="space-y-3">
              {rows.map(row => {
                const perLp = row.preview.details.perLp as Array<{ lp: string; amount: number }> | undefined
                const scalars = Object.entries(row.preview.details).filter(([k]) => k !== 'perLp')
                return (
                  <div key={row.id} className="rounded-card border bg-card p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium">
                        {ACTION_LABELS[row.actionType] ?? row.actionType}
                      </span>
                      <span className="text-sm font-medium">{row.preview.summary}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {row.createdVia ?? 'analyst'} · {new Date(row.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    {scalars.length > 0 && (
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
                        {scalars.map(([k, v]) => (
                          <div key={k} className="contents">
                            <dt className="text-muted-foreground">{k}</dt>
                            <dd className="tabular-nums">{formatVal(v)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}

                    {perLp && perLp.length > 0 && (
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-muted-foreground">
                            <th className="text-left font-medium py-0.5">LP</th>
                            <th className="text-right font-medium py-0.5">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {perLp.map((r, i) => (
                            <tr key={i} className="border-t">
                              <td className="py-0.5">{r.lp}</td>
                              <td className="py-0.5 text-right tabular-nums">{formatVal(r.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => act(row, 'approve')} disabled={busy[row.id]}>
                        {busy[row.id] ? 'Working…' : 'Approve'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => act(row, 'reject')} disabled={busy[row.id]}>
                        Reject
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <AnalystPanel />
      </div>
    </div>
  )
}
