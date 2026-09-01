'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, AlertTriangle, Check, Download, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'

// Onboarding the portfolio tracker's positions onto the ledger.
//
// This is admin, not reporting, so it lives on the Status page rather than on the schedule
// of investments — the schedule reports what the books say, and this is the action that makes
// the books say it. It renders NOTHING unless the tracker holds positions the ledger carries
// none of, which is the one state it exists to resolve.

interface HistoryEvent {
  date: string
  companyId: string
  companyName: string
  costDelta: number
  carryingDelta: number
  unrealizedDelta: number
}
interface HistoryPreview {
  events: HistoryEvent[]
  dates: string[]
  totalCost: number
  totalUnrealized: number
  warnings: string[]
}
interface Soi {
  rows: { name: string }[]
  totalCost: number
  totalFairValue: number
  ledgerCost: number
  source: 'tracker' | 'ledger'
}

export function BootstrapInvestmentsCard() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const lf = useLedgerFetch()
  const [soi, setSoi] = useState<Soi | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [bootDate, setBootDate] = useState(new Date().toISOString().slice(0, 10))
  // Onboarding: replay the dated history (default) vs. book one snapshot (cutover).
  const [mode, setMode] = useState<'history' | 'snapshot'>('history')
  const [from, setFrom] = useState('')
  const [hist, setHist] = useState<HistoryPreview | null>(null)
  const [showEvents, setShowEvents] = useState(false)

  // Inception-to-date, always: the question is whether the ledger has EVER been given these
  // positions, which a period-scoped slice could answer wrongly.
  const load = useCallback(() => {
    lf('/api/accounting/statements?preset=itd')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setSoi(d?.scheduleOfInvestments ?? null))
      .catch(() => setSoi(null))
  }, [lf])
  useEffect(() => { load() }, [load])

  const post = async (body: object, reload = true) => {
    setBusy(true); setError(null); setNote(null)
    const res = await lf('/api/accounting/investments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) { setError(data.error ?? 'Failed'); return null }
    if (reload) load()
    return data
  }

  async function bootstrap(force = false) {
    const d = await post({ action: 'bootstrap', entryDate: bootDate, offset: 'cash', force })
    if (d) setNote(`Booked ${d.companies} ${d.companies === 1 ? 'investment' : 'investments'} — cost ${fmt(d.cost)}, unrealized ${fmt(d.unrealized)}.`)
  }

  // Preview first, always. The replay writes one entry per date per kind — dozens of
  // them for a fund with years of history — so the user sees the shape before it lands.
  async function previewHistory() {
    setHist(null)
    const d = await post({ action: 'previewHistory', from: from || null }, false)
    if (d) setHist(d as HistoryPreview)
  }

  async function replayHistory(force = false) {
    const d = await post({ action: 'replayHistory', from: from || null, force })
    if (d) {
      setHist(null)
      setNote(`Replayed ${d.entries} ${d.entries === 1 ? 'entry' : 'entries'} across ${d.dates} ${d.dates === 1 ? 'date' : 'dates'} — ending cost ${fmt(d.cost)}, unrealized ${fmt(d.unrealized)}.`)
    }
  }

  if (!soi) return null
  // Tracker has positions, ledger has nothing — the one state this card resolves. Once the
  // booking lands, `load` re-runs and the card disappears; `note` is kept visible so the
  // confirmation outlives it.
  const needsBootstrap = soi.source === 'tracker' && Math.abs(soi.ledgerCost) < 0.005 && soi.rows.length > 0
  if (!needsBootstrap && !note && !error) return null

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {note && <p className="text-sm text-success flex items-center gap-1.5"><Check className="h-4 w-4" />{note}</p>}

      {/* The tracker knows the fund holds these companies but the ledger doesn't.
          Booking them RECLASSIFIES out of cash — the cutover opening already credited
          partners' capital for the whole NAV, so crediting it again here would book
          the fund's equity twice. */}
      {needsBootstrap && (
        <div className="rounded-card border border-warning/40 bg-warning/10 p-3 space-y-3">
          <div>
            <p className="text-sm font-medium text-warning flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" />These investments are not on the ledger.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              The tracker holds {soi.rows.length} {soi.rows.length === 1 ? 'position' : 'positions'} at {fmt(soi.totalCost)} cost
              and {fmt(soi.totalFairValue)} fair value, but the ledger carries none. Booking them gives each company its own
              cost and unrealized accounts and moves the value out of cash — partners&rsquo; capital is unchanged either way.
            </p>
          </div>

          <div className="flex gap-1 text-xs">
            {([['history', 'Replay the history'], ['snapshot', 'Book a snapshot']] as const).map(([m, label]) => (
              <button
                key={m}
                onClick={() => { setMode(m); setHist(null); setError(null) }}
                className={`rounded border px-2.5 py-1 ${mode === m ? 'border-warning/60 bg-background font-medium' : 'border-transparent text-muted-foreground hover:bg-background/50'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* The default, and the right answer for a fund being built from full history:
              each purchase and each mark posts on the date it actually happened, so the
              income statement shows the gain in the period it was earned and the close
              allocates it to whoever held capital then. A single lump entry cannot. */}
          {mode === 'history' && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Walks the tracker&rsquo;s dated timeline and books each purchase and each mark on its own date.
                Use this when the vehicle is being built from full history.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-muted-foreground">Skip everything on or before <span className="text-muted-foreground/70">(optional)</span>
                  <Input type="date" value={from} onChange={e => { setFrom(e.target.value); setHist(null) }} className="mt-1 h-9 w-40" />
                </label>
                <Button size="sm" variant="outline" onClick={previewHistory} disabled={busy}>
                  {busy && !hist ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <History className="h-4 w-4 mr-1" />}
                  Preview replay
                </Button>
              </div>

              {hist && (
                <div className="rounded border bg-background p-3 space-y-2">
                  <p className="text-sm">
                    <strong>{hist.events.length}</strong> {hist.events.length === 1 ? 'event' : 'events'} across{' '}
                    <strong>{hist.dates.length}</strong> {hist.dates.length === 1 ? 'date' : 'dates'}
                    {hist.dates.length > 0 && <> — {hist.dates[0]} to {hist.dates[hist.dates.length - 1]}</>}.
                    Ending cost <span className="tabular-nums">{fmt(hist.totalCost)}</span>, unrealized{' '}
                    <span className="tabular-nums">{fmt(hist.totalUnrealized)}</span>.
                  </p>

                  {/* The tracker is the control total. If the replay wouldn't land on it,
                      say so rather than posting dozens of entries that don't tie. */}
                  {Math.abs(hist.totalCost - soi.totalCost) > 0.005 || Math.abs(hist.totalCost + hist.totalUnrealized - soi.totalFairValue) > 0.005 ? (
                    <p className="text-sm text-warning">
                      Heads up: this lands at {fmt(hist.totalCost + hist.totalUnrealized)} carrying value, but the tracker
                      shows {fmt(soi.totalFairValue)}. Replay only what you mean to.
                    </p>
                  ) : (
                    <p className="text-xs text-success flex items-center gap-1">
                      <Check className="h-3.5 w-3.5" />Lands exactly on the tracker&rsquo;s cost and fair value.
                    </p>
                  )}

                  {hist.warnings.map((w, i) => (
                    <p key={i} className="text-sm text-warning flex items-start gap-1">
                      <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />{w}
                    </p>
                  ))}

                  <button
                    onClick={() => setShowEvents(s => !s)}
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    {showEvents ? 'Hide' : 'Show'} the {hist.events.length} {hist.events.length === 1 ? 'event' : 'events'}
                  </button>

                  {showEvents && (
                    <div className="max-h-64 overflow-y-auto border rounded">
                      <table className="w-full text-xs whitespace-nowrap">
                        <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                          <tr className="border-b">
                            <th className="text-left px-2 py-1.5 font-medium">Date</th>
                            <th className="text-left px-2 py-1.5 font-medium">Investment</th>
                            <th className="text-right px-2 py-1.5 font-medium">Purchase</th>
                            <th className="text-right px-2 py-1.5 font-medium">Mark</th>
                          </tr>
                        </thead>
                        <tbody>
                          {hist.events.map((e, i) => (
                            <tr key={i} className="border-b last:border-b-0">
                              <td className="px-2 py-1 tabular-nums text-muted-foreground">{e.date}</td>
                              <td className="px-2 py-1">{e.companyName}</td>
                              <td className="px-2 py-1 text-right tabular-nums">{e.costDelta === 0 ? '—' : fmt(e.costDelta)}</td>
                              <td className={`px-2 py-1 text-right tabular-nums ${e.unrealizedDelta < 0 ? 'text-destructive' : ''}`}>
                                {e.unrealizedDelta === 0 ? '—' : fmt(e.unrealizedDelta)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" onClick={() => replayHistory(hist.warnings.length > 0)} disabled={busy || hist.events.length === 0}>
                      {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <History className="h-4 w-4 mr-1" />}
                      {hist.warnings.length > 0 ? 'Replay anyway' : `Replay onto the ledger`}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setHist(null)} disabled={busy}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* The cutover case: the fund's books start on a date and the history before it
              is somebody else's problem. One entry, everything at its carrying value. */}
          {mode === 'snapshot' && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Books one entry putting every position on at its current cost and fair value. Use this when the vehicle&rsquo;s
                books start at a cutover date and the history before it isn&rsquo;t being reconstructed — the gains all land
                on the date below, so the close will allocate them to that period.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-muted-foreground">As of
                  <Input type="date" value={bootDate} onChange={e => setBootDate(e.target.value)} className="mt-1 h-9 w-40" />
                </label>
                <Button size="sm" variant="outline" onClick={() => bootstrap()} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
                  Book the snapshot
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
