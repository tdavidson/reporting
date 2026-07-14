'use client'

// Live vs stored: does the ledger reproduce this snapshot?
//
// The stored snapshot is the baseline — hand-imported, hand-corrected, and trusted. This
// page derives the same figures from the books (or from lp_capital_events, for vehicles with
// no books) as of the snapshot's own date, and shows where they disagree.
//
// A variance is NOT automatically a ledger bug. It usually means one of:
//   - the vehicle's books are incomplete (an unbooked SPV shows zeros)
//   - a period hasn't been closed, so P&L hasn't reached capital accounts yet
//   - the snapshot itself has drifted (e.g. the associates calc ran twice)
// The point of the page is to make the disagreement visible and attributable, not to declare
// a winner. Nothing here writes.

import React, { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Loader2, ArrowLeft, AlertTriangle, Check, BookOpen, ListTree } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useCurrency, formatCurrencyFull, formatCurrencyPrice } from '@/components/currency-context'

const COLUMNS = [
  { key: 'commitment', label: 'Commitment' },
  { key: 'called_capital', label: 'Called' },
  { key: 'paid_in_capital', label: 'Paid in' },
  { key: 'distributions', label: 'Distributions' },
  { key: 'nav', label: 'NAV' },
  { key: 'total_value', label: 'Total value' },
] as const

type ColKey = (typeof COLUMNS)[number]['key']

interface CompareRow {
  entity_id: string
  entity_name: string
  portfolio_group: string
  source: 'ledger' | 'events' | null
  presence: 'both' | 'live_only' | 'stored_only'
  live: Partial<Record<ColKey, number | null>>
  stored: Partial<Record<ColKey, number | null>>
  delta: Partial<Record<ColKey, number | null>>
  differs: boolean
}

interface Payload {
  snapshotName: string | null
  asOf: string | null
  vehicles: { group: string; source: 'ledger' | 'events'; lps: number }[]
  summary: { total: number; differing: number; liveOnly: number; storedOnly: number }
  rows: CompareRow[]
}

export default function CompareSnapshotPage() {
  const params = useParams()
  const router = useRouter()
  const snapshotId = params.snapshotId as string
  const currency = useCurrency()

  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [onlyDiffs, setOnlyDiffs] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/lps/live-report?snapshotId=${snapshotId}`)
      .then(async r => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || 'Failed to load comparison')
        return j as Payload
      })
      .then(j => { if (!cancelled) { setData(j); setError(null) } })
      .catch(e => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [snapshotId])

  const rows = useMemo(
    () => (data?.rows ?? []).filter(r => !onlyDiffs || r.differs),
    [data, onlyDiffs]
  )

  // Exact, never abbreviated: a variance view that renders $1.2M on both sides hides
  // precisely the break it exists to surface.
  const money = (v: number | null | undefined) =>
    v == null ? <span className="text-muted-foreground">—</span> : formatCurrencyFull(v, currency)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Deriving the report from the ledger…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Card><CardContent className="p-6 text-red-600">{error ?? 'No data'}</CardContent></Card>
      </div>
    )
  }

  const { summary, vehicles } = data
  const clean = summary.differing === 0

  return (
    <div className="p-6 space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-3 -ml-2">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to snapshot
        </Button>
        <h1 className="text-2xl font-semibold">Live vs stored</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {data.snapshotName ?? 'Snapshot'}
          {data.asOf && <> · derived as of <span className="font-medium">{data.asOf}</span></>}
        </p>
      </div>

      {/* Provenance: which vehicles have real books, and which are answering from events.
          A vehicle sourced from 'events' with no events entered will show zeros against a
          populated snapshot — that is expected, not a break, and the reader needs to see it
          before reading a single variance. */}
      <Card>
        <CardContent className="p-4">
          <div className="text-sm font-medium mb-3">Where each vehicle's numbers come from</div>
          <div className="flex flex-wrap gap-2">
            {vehicles.map(v => (
              <Badge key={v.group} variant="outline" className="gap-1.5 py-1">
                {v.source === 'ledger'
                  ? <BookOpen className="h-3.5 w-3.5" />
                  : <ListTree className="h-3.5 w-3.5" />}
                <span className="font-medium">{v.group}</span>
                <span className="text-muted-foreground">
                  {v.source === 'ledger' ? 'ledger' : 'events'} · {v.lps} LP{v.lps === 1 ? '' : 's'}
                </span>
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Rows compared" value={String(summary.total)} />
        <Stat
          label="Differing"
          value={String(summary.differing)}
          tone={clean ? 'good' : 'warn'}
        />
        <Stat label="In ledger only" value={String(summary.liveOnly)} tone={summary.liveOnly ? 'warn' : undefined} />
        <Stat label="In snapshot only" value={String(summary.storedOnly)} tone={summary.storedOnly ? 'warn' : undefined} />
      </div>

      {clean ? (
        <Card>
          <CardContent className="p-6 flex items-center gap-3 text-emerald-700 dark:text-emerald-400">
            <Check className="h-5 w-5" />
            <div>
              <div className="font-medium">The ledger reproduces this snapshot exactly.</div>
              <div className="text-sm text-muted-foreground">
                Every LP × vehicle row matches to the cent. This snapshot could be generated live.
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex items-center gap-3">
          <Button
            variant={onlyDiffs ? 'default' : 'outline'}
            size="sm"
            onClick={() => setOnlyDiffs(v => !v)}
          >
            {onlyDiffs ? 'Showing differences only' : 'Showing all rows'}
          </Button>
          <span className="text-sm text-muted-foreground">
            {summary.differing} of {summary.total} rows differ
          </span>
        </div>
      )}

      {rows.length > 0 && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left font-medium p-3 sticky left-0 bg-muted/40">LP</th>
                  <th className="text-left font-medium p-3">Vehicle</th>
                  {COLUMNS.map(c => (
                    <th key={c.key} className="text-right font-medium p-3 whitespace-nowrap">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <React.Fragment key={`${row.entity_id}-${row.portfolio_group}`}>
                    <tr className="border-b border-b-transparent">
                      <td className="p-3 pb-1 align-bottom sticky left-0 bg-background" rowSpan={3}>
                        <div className="font-medium">{row.entity_name}</div>
                        {row.presence !== 'both' && (
                          <Badge variant="outline" className="mt-1 gap-1 text-amber-600 border-amber-300">
                            <AlertTriangle className="h-3 w-3" />
                            {row.presence === 'live_only' ? 'not in snapshot' : 'not in ledger'}
                          </Badge>
                        )}
                      </td>
                      <td className="p-3 pb-1 align-bottom text-muted-foreground" rowSpan={3}>
                        {row.portfolio_group}
                      </td>
                      {COLUMNS.map(c => (
                        <td key={c.key} className="text-right p-3 pb-0.5 tabular-nums whitespace-nowrap">
                          {money(row.live[c.key])}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-b-transparent text-muted-foreground">
                      {COLUMNS.map(c => (
                        <td key={c.key} className="text-right px-3 py-0.5 tabular-nums whitespace-nowrap">
                          {money(row.stored[c.key])}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b">
                      {COLUMNS.map(c => {
                        const d = row.delta[c.key]
                        const material = d != null && Math.abs(d) > 0.01
                        return (
                          <td
                            key={c.key}
                            className={`text-right px-3 pt-0.5 pb-3 tabular-nums whitespace-nowrap text-xs ${
                              material ? 'text-red-600 font-medium' : 'text-muted-foreground/50'
                            }`}
                          >
                            {d == null ? '—' : material ? `${d > 0 ? '+' : ''}${formatCurrencyPrice(d, currency)}` : '·'}
                          </td>
                        )
                      })}
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            <div className="p-3 text-xs text-muted-foreground border-t flex gap-4">
              <span><span className="text-foreground font-medium">Row 1</span> live (derived)</span>
              <span><span className="font-medium">Row 2</span> stored (snapshot)</span>
              <span><span className="text-red-600 font-medium">Row 3</span> difference</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' }) {
  const color =
    tone === 'good' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-foreground'
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold mt-1 tabular-nums ${color}`}>{value}</div>
      </CardContent>
    </Card>
  )
}
