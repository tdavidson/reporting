'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, AlertTriangle, Check, Download, Pencil, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'

interface SoiRow {
  name: string
  cost: number
  fairValue: number
  pctOfNetAssets: number
  companyId?: string
  industry?: string | null
  assetType?: string
  shares?: number | null
  sharePrice?: number | null
  moic?: number | null
  // Present once the company has its own 1100-<id> / 1200-<id> accounts.
  ledgerCost?: number
  ledgerFairValue?: number
  tiesOut?: boolean
}
interface SoiGroup { name: string; cost: number; fairValue: number; pctOfNetAssets: number }
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
  rows: SoiRow[]
  totalCost: number
  totalFairValue: number
  netAssets: number
  source: 'tracker' | 'ledger'
  ledgerCost: number
  ledgerFairValue: number
  costVariance: number
  fairValueVariance: number
  byIndustry: SoiGroup[]
  byGeography: SoiGroup[]
  byAssetType: SoiGroup[]
}

export function ScheduleOfInvestmentsView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`
  const [soi, setSoi] = useState<Soi | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [bootDate, setBootDate] = useState(new Date().toISOString().slice(0, 10))
  const [marking, setMarking] = useState<{ companyId: string; name: string; value: string; date: string } | null>(null)
  // Onboarding: replay the dated history (default) vs. book one snapshot (cutover).
  const [mode, setMode] = useState<'history' | 'snapshot'>('history')
  const [from, setFrom] = useState('')
  const [hist, setHist] = useState<HistoryPreview | null>(null)
  const [showEvents, setShowEvents] = useState(false)
  const lf = useLedgerFetch()

  const load = useCallback(() => {
    setLoading(true)
    lf('/api/accounting/statements')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setSoi(d?.scheduleOfInvestments ?? null))
      .finally(() => setLoading(false))
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

  async function saveMark() {
    if (!marking) return
    const v = parseFloat(marking.value)
    if (!Number.isFinite(v)) { setError('Enter a fair value (0 to write it off)'); return }
    const d = await post({
      action: 'mark', companyId: marking.companyId, companyName: marking.name,
      fairValue: v, entryDate: marking.date,
    })
    if (d) { setNote(`Marked ${marking.name} to ${fmt(v)} (change of ${fmt(d.delta)}).`); setMarking(null) }
  }

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
  if (!soi || soi.rows.length === 0) {
    return <div className="border border-dashed rounded-lg p-8 text-center text-sm text-muted-foreground">No investments booked yet. Record the investment purchase (Dr 1100 / Cr 1000) and revalue it.</div>
  }

  const tied = soi.costVariance === 0 && soi.fairValueVariance === 0
  // Tracker has positions, ledger has nothing — the case the Status page blocks on.
  const needsBootstrap = soi.source === 'tracker' && Math.abs(soi.ledgerCost) < 0.005 && soi.rows.length > 0
  const num = (v: number | null | undefined, dp = 0) =>
    v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })

  const groupTable = (title: string, groups: SoiGroup[]) => (
    <div className="border rounded-lg overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left px-3 py-2 font-medium">{title}</th>
            <th className="text-right px-3 py-2 font-medium">Cost</th>
            <th className="text-right px-3 py-2 font-medium">Fair value</th>
            <th className="text-right px-3 py-2 font-medium">% of net assets</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <tr key={g.name} className="border-b last:border-b-0">
              <td className="px-3 py-2">{g.name}</td>
              <td className="px-3 py-2 text-right font-mono">{fmt(g.cost)}</td>
              <td className="px-3 py-2 text-right font-mono">{fmt(g.fairValue)}</td>
              <td className="px-3 py-2 text-right font-mono text-muted-foreground">{pct(g.pctOfNetAssets)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="space-y-5">
      {/* The SOI's rows come from the portfolio tracker; the ledger is the control
          total. If they disagree, say so loudly rather than showing a tidy number. */}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {note && <p className="text-sm text-green-700 dark:text-green-400 flex items-center gap-1.5"><Check className="h-4 w-4" />{note}</p>}

      {/* The tracker knows the fund holds these companies but the ledger doesn't.
          Booking them RECLASSIFIES out of cash — the cutover opening already credited
          partners' capital for the whole NAV, so crediting it again here would book
          the fund's equity twice. */}
      {needsBootstrap && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-3">
          <div>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
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
                className={`rounded border px-2.5 py-1 ${mode === m ? 'border-amber-500/60 bg-background font-medium' : 'border-transparent text-muted-foreground hover:bg-background/50'}`}
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
                    Ending cost <span className="font-mono">{fmt(hist.totalCost)}</span>, unrealized{' '}
                    <span className="font-mono">{fmt(hist.totalUnrealized)}</span>.
                  </p>

                  {/* The tracker is the control total. If the replay wouldn't land on it,
                      say so rather than posting dozens of entries that don't tie. */}
                  {Math.abs(hist.totalCost - soi.totalCost) > 0.005 || Math.abs(hist.totalCost + hist.totalUnrealized - soi.totalFairValue) > 0.005 ? (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Heads up: this lands at {fmt(hist.totalCost + hist.totalUnrealized)} carrying value, but the tracker
                      shows {fmt(soi.totalFairValue)}. Replay only what you mean to.
                    </p>
                  ) : (
                    <p className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1">
                      <Check className="h-3.5 w-3.5" />Lands exactly on the tracker&rsquo;s cost and fair value.
                    </p>
                  )}

                  {hist.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1">
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
                              <td className="px-2 py-1 font-mono text-muted-foreground">{e.date}</td>
                              <td className="px-2 py-1">{e.companyName}</td>
                              <td className="px-2 py-1 text-right font-mono">{e.costDelta === 0 ? '—' : fmt(e.costDelta)}</td>
                              <td className={`px-2 py-1 text-right font-mono ${e.unrealizedDelta < 0 ? 'text-red-600' : ''}`}>
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

      <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${tied ? 'text-muted-foreground' : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
        {tied ? <Check className="h-4 w-4 mt-0.5 shrink-0 text-green-600" /> : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />}
        {tied ? (
          <span>Ties to the ledger — cost {fmt(soi.ledgerCost)}, fair value {fmt(soi.ledgerFairValue)}.</span>
        ) : (
          <span>
            <strong>Does not tie to the ledger.</strong> The tracker says cost {fmt(soi.totalCost)} / fair value {fmt(soi.totalFairValue)};
            the ledger says {fmt(soi.ledgerCost)} / {fmt(soi.ledgerFairValue)}.
            Variance: cost <span className="font-mono">{fmt(soi.costVariance)}</span>, fair value <span className="font-mono">{fmt(soi.fairValueVariance)}</span>.
            A mark or purchase was recorded in one system and not the other.
          </span>
        )}
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-3 py-2 font-medium">Investment</th>
              <th className="text-left px-3 py-2 font-medium">Industry</th>
              <th className="text-left px-3 py-2 font-medium">Type</th>
              <th className="text-right px-3 py-2 font-medium">Shares</th>
              <th className="text-right px-3 py-2 font-medium">Price</th>
              <th className="text-right px-3 py-2 font-medium">Cost</th>
              <th className="text-right px-3 py-2 font-medium">Fair value</th>
              <th className="text-right px-3 py-2 font-medium border-l">Ledger FV</th>
              <th className="text-right px-3 py-2 font-medium">MOIC</th>
              <th className="text-right px-3 py-2 font-medium">% of net assets</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {soi.rows.map((r, i) => (
              <tr key={r.name + i} className="border-b last:border-b-0 hover:bg-muted/20">
                <td className="px-3 py-2">
                  {r.name}
                  {/* A per-company tie-out is only possible once the company has its own
                      accounts. The aggregate line can't tell you which position is off. */}
                  {r.tiesOut === false && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wider px-1 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400">off ledger</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.industry ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.assetType ?? '—'}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{num(r.shares)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{r.sharePrice == null ? '—' : fmt(r.sharePrice)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(r.cost)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(r.fairValue)}</td>
                <td className={`px-3 py-2 text-right font-mono border-l ${r.tiesOut === false ? 'text-amber-600' : 'text-muted-foreground'}`}>
                  {r.ledgerFairValue == null ? '—' : fmt(r.ledgerFairValue)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{r.moic == null ? '—' : `${r.moic.toFixed(2)}×`}</td>
                <td className="px-3 py-2 text-right font-mono text-muted-foreground">{pct(r.pctOfNetAssets)}</td>
                <td className="px-3 py-2 text-right">
                  {r.companyId && (
                    <button
                      onClick={() => setMarking({ companyId: r.companyId!, name: r.name, value: String(r.fairValue), date: new Date().toISOString().slice(0, 10) })}
                      className="text-xs border border-input rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground inline-flex items-center gap-1"
                    >
                      <Pencil className="h-3 w-3" />Mark
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/30 font-semibold">
              <td className="px-3 py-2" colSpan={5}>Total (net assets {fmt(soi.netAssets)})</td>
              <td className="px-3 py-2 text-right font-mono">{fmt(soi.totalCost)}</td>
              <td className="px-3 py-2 text-right font-mono">{fmt(soi.totalFairValue)}</td>
              <td />
              <td className="px-3 py-2 text-right font-mono text-muted-foreground">{soi.netAssets ? pct(soi.totalFairValue / soi.netAssets) : '—'}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Marking ONE company. A write-off is simply fair value 0: the carrying value
          goes to zero while the cost stays on the books, which is exactly what a
          written-off position looks like. Only possible per-company because each has
          its own 1200-<id> account now. */}
      {marking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setMarking(null)}>
          <div className="w-full max-w-md rounded-lg border bg-card p-4 shadow-xl space-y-3" onClick={e => e.stopPropagation()}>
            <div>
              <p className="text-sm font-medium">Mark {marking.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Books the change in unrealized against this company&rsquo;s own account. Enter <strong>0</strong> to write it off.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-muted-foreground flex-1 min-w-[140px]">Fair value
                <Input
                  value={marking.value}
                  onChange={e => setMarking(m => m && { ...m, value: e.target.value })}
                  inputMode="decimal"
                  className="mt-1 h-9 w-full font-mono"
                />
              </label>
              <label className="text-xs text-muted-foreground">As of
                <Input
                  type="date"
                  value={marking.date}
                  onChange={e => setMarking(m => m && { ...m, date: e.target.value })}
                  className="mt-1 h-9 w-40"
                />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={saveMark} disabled={busy}>
                {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Post mark
              </Button>
              <Button size="sm" variant="outline" onClick={() => setMarking(null)} disabled={busy}>Cancel</Button>
              <button
                onClick={() => setMarking(m => m && { ...m, value: '0' })}
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground ml-auto"
              >
                Write off
              </button>
            </div>
          </div>
        </div>
      )}

      {soi.source === 'tracker' && (
        <div className="grid gap-4 md:grid-cols-2">
          {soi.byIndustry.length > 0 && groupTable('By industry', soi.byIndustry)}
          {soi.byAssetType.length > 0 && groupTable('By asset type', soi.byAssetType)}
          {soi.byGeography.length > 0 && groupTable('By geography', soi.byGeography)}
        </div>
      )}
    </div>
  )
}
