'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Check, AlertTriangle, Undo2, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/confirm-dialog'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'

// Copy the latest LP snapshot into the vehicles as capital events.
//
// FUND-WIDE, unlike everything else on this page — it runs across every vehicle at once,
// which is the point: it is how you stop re-importing a spreadsheet and start tracking
// capital. So it does NOT use useLedgerFetch (which would scope it to the selected
// vehicle) and it says so on the tin.

interface PlannedEvent { sourceType: string; amount: number; memo: string }
interface PlannedLp {
  lpEntityId: string; name: string; commitment: number; snapshotNav: number
  endingCapital: number; events: PlannedEvent[]; hasCommitment: boolean; warnings: string[]
}
interface PlannedVehicle {
  vehicle: string; action: 'copy' | 'skip'; skipReason?: string
  lps: PlannedLp[]; totalNav: number; eventCount: number; commitmentsToCreate: number
}
interface Preview {
  snapshot: { id: string; name: string; asOf: string }
  vehicles: PlannedVehicle[]
  totals: { vehicles: number; lps: number; events: number; commitments: number; warnings: number }
  alreadyImported: boolean
}

const EVENT_LABEL: Record<string, string> = {
  capital_call: 'Capital recognized',
  distribution: 'Distributions',
  valuation: 'Cumulative gain/(loss)',
}

export function SnapshotCutover() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const confirm = useConfirm()

  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ events: number; commitments: number; vehicles: string[]; errors: string[] } | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/accounting/cutover')
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else { setPreview(d); setError(null) } })
      .catch(() => setError('Could not load the snapshot.'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  async function run() {
    if (!preview) return
    const ok = await confirm({
      title: `Copy "${preview.snapshot.name}" into ${preview.totals.vehicles} vehicle${preview.totals.vehicles === 1 ? '' : 's'}?`,
      description:
        `This writes ${preview.totals.events} capital events for ${preview.totals.lps} LPs, dated ${preview.snapshot.asOf}. ` +
        `Nothing is deleted, and it can be undone.`,
      confirmLabel: 'Copy',
    })
    if (!ok) return
    setRunning(true)
    setError(null)
    const res = await fetch('/api/accounting/cutover', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot: preview.snapshot.id }),
    })
    const d = await res.json()
    setRunning(false)
    if (!res.ok) { setError(d.error ?? 'Cutover failed'); return }
    setDone({ events: d.eventsWritten, commitments: d.commitmentsWritten, vehicles: d.vehicles, errors: d.errors ?? [] })
    load()
  }

  async function revert() {
    if (!preview) return
    const ok = await confirm({
      title: 'Undo this import?',
      description: 'Deletes every capital event copied from this snapshot. Hand-entered events are untouched.',
      confirmLabel: 'Undo import',
      variant: 'destructive',
    })
    if (!ok) return
    setRunning(true)
    const res = await fetch(`/api/accounting/cutover?snapshot=${preview.snapshot.id}`, { method: 'DELETE' })
    const d = await res.json()
    setRunning(false)
    if (!res.ok) { setError(d.error ?? 'Revert failed'); return }
    setDone(null)
    load()
  }

  if (loading) {
    return (
      <div className="rounded-lg border p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the latest LP snapshot…
      </div>
    )
  }
  if (error && !preview) {
    return <div className="rounded-lg border p-4 text-sm text-muted-foreground">{error}</div>
  }
  if (!preview) return null

  const copying = preview.vehicles.filter(v => v.action === 'copy')
  const skipped = preview.vehicles.filter(v => v.action === 'skip')

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Copy the LP snapshot into the vehicles</h2>
        <p className="text-xs text-muted-foreground max-w-3xl">
          Takes the figures from <strong>{preview.snapshot.name}</strong> (as of {preview.snapshot.asOf}) and writes them
          into each vehicle as capital events, so capital accounts derive from the vehicle instead of the imported
          spreadsheet. <strong>Fund-wide</strong> — it runs across every vehicle, not just the one selected above. The
          snapshot is copied, not moved: it keeps working exactly as it does now.
        </p>
      </div>

      {preview.alreadyImported && !done && (
        <p className="text-xs rounded-md border border-amber-300/50 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 px-2.5 py-2">
          This snapshot has already been copied in. Running it again is a no-op, not a double-count — but you probably
          want <strong>Undo import</strong> if you meant to start over.
        </p>
      )}

      {done && (
        <div className="rounded-md border p-3 text-sm space-y-1">
          <p className="flex items-center gap-1.5 text-green-700 dark:text-green-400">
            <Check className="h-4 w-4" />
            Copied {done.events} events{done.commitments > 0 ? ` and ${done.commitments} commitments` : ''} into{' '}
            {done.vehicles.join(', ')}.
          </p>
          {done.errors.map((e, i) => <p key={i} className="text-xs text-amber-600">{e}</p>)}
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {/* Totals */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <Stat label="Vehicles" value={String(preview.totals.vehicles)} />
        <Stat label="LPs" value={String(preview.totals.lps)} />
        <Stat label="Events" value={String(preview.totals.events)} />
        <Stat label="Commitments to create" value={String(preview.totals.commitments)} />
        {preview.totals.warnings > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            {preview.totals.warnings} warning{preview.totals.warnings === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* Per-vehicle plan */}
      <div className="space-y-2">
        {copying.map(v => (
          <div key={v.vehicle} className="rounded-md border">
            <button
              className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/40"
              onClick={() => setExpanded(expanded === v.vehicle ? null : v.vehicle)}
            >
              <span className="text-sm font-medium">{v.vehicle}</span>
              <span className="text-xs text-muted-foreground">
                {v.lps.length} LP{v.lps.length === 1 ? '' : 's'} · {v.eventCount} events · NAV {fmt(v.totalNav)}
              </span>
            </button>

            {expanded === v.vehicle && (
              <div className="border-t overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-1.5 font-medium">LP</th>
                      <th className="text-right px-3 py-1.5 font-medium">Committed</th>
                      {Object.keys(EVENT_LABEL).map(k => (
                        <th key={k} className="text-right px-3 py-1.5 font-medium">{EVENT_LABEL[k]}</th>
                      ))}
                      <th className="text-right px-3 py-1.5 font-medium">Ending</th>
                      <th className="text-right px-3 py-1.5 font-medium">Snapshot NAV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.lps.map(lp => {
                      // The events are debit-positive. Show them the way a person reads a capital
                      // account — a contribution is a positive number that went IN.
                      const amt = (t: string) => {
                        const e = lp.events.find(x => x.sourceType === t)
                        return e ? -e.amount : 0
                      }
                      const ties = Math.abs(lp.endingCapital - lp.snapshotNav) < 0.005
                      return (
                        <tr key={lp.lpEntityId} className="border-t">
                          <td className="px-3 py-1.5">
                            {lp.name}
                            {!lp.hasCommitment && lp.commitment > 0 && (
                              <span className="ml-1.5 text-[10px] text-muted-foreground">+ commitment</span>
                            )}
                            {lp.warnings.map((w, i) => (
                              <span key={i} className="block text-[10px] text-amber-600">{w}</span>
                            ))}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{fmt(lp.commitment)}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{fmt(amt('capital_call'))}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{fmt(-amt('distribution'))}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{fmt(amt('valuation'))}</td>
                          <td className="px-3 py-1.5 text-right font-mono font-medium">{fmt(lp.endingCapital)}</td>
                          {/* The check that matters: the events must reproduce the snapshot's NAV. */}
                          <td className={`px-3 py-1.5 text-right font-mono ${ties ? 'text-muted-foreground' : 'text-red-600 font-medium'}`}>
                            {fmt(lp.snapshotNav)}{ties ? '' : ' ✕'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}

        {skipped.length > 0 && (
          <div className="rounded-md border border-dashed p-3 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Skipped</p>
            {skipped.map(v => (
              <p key={v.vehicle} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground/70">{v.vehicle}</span> — {v.skipReason}
              </p>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground max-w-3xl">
        The cumulative gain/(loss) is booked as an unrealized valuation: a snapshot cannot say how much of it was
        realized, so it is right in total and not split. Funded-vs-unfunded is not in the snapshot either — every copied
        LP starts with called = funded, and any unfunded call should be recorded afterwards as a call.
      </p>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={run} disabled={running || copying.length === 0}>
          {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ArrowRight className="h-4 w-4 mr-1" />}
          Copy into {copying.length} vehicle{copying.length === 1 ? '' : 's'}
        </Button>
        {preview.alreadyImported && (
          <Button size="sm" variant="outline" onClick={revert} disabled={running}>
            <Undo2 className="h-4 w-4 mr-1" />
            Undo import
          </Button>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-muted-foreground">
      {label} <span className="font-mono font-medium text-foreground">{value}</span>
    </span>
  )
}
