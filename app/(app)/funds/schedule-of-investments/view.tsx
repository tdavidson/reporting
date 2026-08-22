'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Loader2, AlertTriangle, Check, Download, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCurrency, formatCurrencyPrice, formatSharePrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'
import { PeriodPicker } from '@/components/accounting/period-picker'
import type { PeriodPreset } from '@/lib/accounting/statement-period'
import { EmptyState } from '@/components/ui/empty-state'

interface SoiRow {
  name: string
  holdingType?: 'company' | 'fund'
  cost: number
  fairValue: number
  pctOfNetAssets: number
  companyId?: string
  industry?: string | null
  assetType?: string
  shares?: number | null
  sharePrice?: number | null
  moic?: number | null
  /** ASC 820 fair value hierarchy. Absent reads as Level 3. */
  valuationLevel?: 1 | 2 | 3
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
  /** Empty for a wholly private book, where every position is Level 3. */
  byLevel: SoiGroup[]
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
  // Onboarding: replay the dated history (default) vs. book one snapshot (cutover).
  const [mode, setMode] = useState<'history' | 'snapshot'>('history')
  const [from, setFrom] = useState('')
  const [hist, setHist] = useState<HistoryPreview | null>(null)
  const [showEvents, setShowEvents] = useState(false)
  const [preset, setPreset] = useState<PeriodPreset>('itd')
  const [asOf, setAsOf] = useState('') // '' = latest
  const lf = useLedgerFetch()

  const load = useCallback(() => {
    setLoading(true)
    const qs = new URLSearchParams({ preset })
    if (asOf) qs.set('asOf', asOf)
    lf(`/api/accounting/statements?${qs}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => setSoi(d?.scheduleOfInvestments ?? null))
      .finally(() => setLoading(false))
  }, [lf, preset, asOf])
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

  const content = (() => {
    if (!soi) return null
    const tied = soi.costVariance === 0 && soi.fairValueVariance === 0
    // Tracker has positions, ledger has nothing — the case the Status page blocks on.
    const needsBootstrap = soi.source === 'tracker' && Math.abs(soi.ledgerCost) < 0.005 && soi.rows.length > 0
    const num = (v: number | null | undefined, dp = 0) =>
      v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })

    // Fund holdings and company holdings get their OWN sections rather than one mixed table:
    // a fund position has no share count and a company position has no unfunded commitment,
    // so a single table would render half its columns blank for every row. The ledger control
    // total below still covers both — only the display is split.
    const fundRows = soi.rows.filter(r => r.holdingType === 'fund')
    const companyRows = soi.rows.filter(r => r.holdingType !== 'fund')
    // The Level column appears only once something is ABOVE Level 3. A wholly private book is
    // Level 3 by construction, and a column repeating "3" on every row is noise that makes the
    // one number a reader should notice harder to find.
    const showLevel = (soi.byLevel?.length ?? 0) > 0

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
                <td className="px-3 py-2 text-right tabular-nums">{fmt(g.cost)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(g.fairValue)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{pct(g.pctOfNetAssets)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )

    return (
      <>
      {/* The SOI's rows come from the portfolio tracker; the ledger is the control
          total. If they disagree, say so loudly rather than showing a tidy number. */}
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

      <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${tied ? 'text-muted-foreground' : 'border-warning/40 bg-warning/10 text-warning dark:text-warning'}`}>
        {tied ? <Check className="h-4 w-4 mt-0.5 shrink-0 text-success" /> : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />}
        {tied ? (
          <span>Ties to the ledger — cost {fmt(soi.ledgerCost)}, fair value {fmt(soi.ledgerFairValue)}.</span>
        ) : (
          <span>
            <strong>Does not tie to the ledger.</strong> The tracker says cost {fmt(soi.totalCost)} / fair value {fmt(soi.totalFairValue)};
            the ledger says {fmt(soi.ledgerCost)} / {fmt(soi.ledgerFairValue)}.
            Variance: cost <span className="tabular-nums">{fmt(soi.costVariance)}</span>, fair value <span className="tabular-nums">{fmt(soi.fairValueVariance)}</span>.
            A mark or purchase was recorded in one system and not the other.
          </span>
        )}
      </div>

      {([
        ['Underlying funds', fundRows] as const,
        [fundRows.length > 0 ? 'Direct investments' : 'Investment', companyRows] as const,
      ]).filter(([, rs]) => rs.length > 0).map(([heading, rs]) => (
      <div key={heading} className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-3 py-2 font-medium">{heading}</th>
              <th className="text-left px-3 py-2 font-medium">Industry</th>
              <th className="text-left px-3 py-2 font-medium">Type</th>
              {showLevel && <th className="text-left px-3 py-2 font-medium">Level</th>}
              <th className="text-right px-3 py-2 font-medium">Shares</th>
              <th className="text-right px-3 py-2 font-medium">Price</th>
              <th className="text-right px-3 py-2 font-medium">Cost</th>
              <th className="text-right px-3 py-2 font-medium">Fair value</th>
              <th className="text-right px-3 py-2 font-medium">MOIC</th>
              <th className="text-right px-3 py-2 font-medium">% of net assets</th>
            </tr>
          </thead>
          <tbody>
            {rs.map((r, i) => (
              <tr key={r.name + i} className="border-b last:border-b-0 hover:bg-muted/20">
                <td className="px-3 py-2">
                  {r.name}
                  {/* A per-company tie-out is only possible once the company has its own
                      accounts. The aggregate line can't tell you which position is off. */}
                  {r.tiesOut === false && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wider px-1 py-0.5 rounded bg-warning/15 text-warning">off ledger</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.industry ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.assetType ?? '—'}</td>
                {showLevel && (
                  <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">{r.valuationLevel ?? 3}</td>
                )}
                <td className="px-3 py-2 text-right tabular-nums text-xs">{num(r.shares)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-xs">{r.sharePrice == null ? '—' : formatSharePrice(r.sharePrice, currency)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(r.cost)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(r.fairValue)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">{r.moic == null ? '—' : `${r.moic.toFixed(2)}×`}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{pct(r.pctOfNetAssets)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/30 font-semibold">
              <td className="px-3 py-2" colSpan={showLevel ? 6 : 5}>Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(rs.reduce((a, r) => a + r.cost, 0))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(rs.reduce((a, r) => a + r.fairValue, 0))}</td>
              <td />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      ))}

      {/* Both sections together, against the ledger — the control total is unchanged by the split. */}
      {fundRows.length > 0 && companyRows.length > 0 && (
        <div className="border rounded-lg px-3 py-2 flex items-center justify-between text-sm font-semibold">
          <span>Total investments</span>
          <span className="tabular-nums">{fmt(soi.totalCost)} cost · {fmt(soi.totalFairValue)} fair value</span>
        </div>
      )}

      {soi.source === 'tracker' && (
        <div className="grid gap-4 md:grid-cols-2">
          {soi.byIndustry.length > 0 && groupTable('By industry', soi.byIndustry)}
          {soi.byAssetType.length > 0 && groupTable('By asset type', soi.byAssetType)}
          {soi.byGeography.length > 0 && groupTable('By geography', soi.byGeography)}
          {/* ASC 820. Present only once a position is priced by something other than judgement. */}
          {(soi.byLevel?.length ?? 0) > 0 && groupTable('By fair value level', soi.byLevel)}
        </div>
      )}
      </>
    )
  })()

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {/* As-of snapshot date — SOI is a point in time, so only the period END matters.
            No custom range: the presets + As of cover every as-of date. */}
        <span className="text-sm text-muted-foreground">Investments</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <PeriodPicker
            preset={preset} onPreset={setPreset}
            start="" end="" onStart={() => {}} onEnd={() => {}}
            asOf={asOf} onAsOf={setAsOf}
            allowAsOf allowCustom={false}
            presets={['this_quarter', 'last_quarter', 'ytd', 'prior_year', 'itd']}
            title="Investments as of this date"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
      ) : !soi || soi.rows.length === 0 ? (
        <EmptyState
          // Investments are recorded on a company page, and every company is
          // reachable from Portfolio — so that is the way in from here.
          action={
            <Button size="sm" variant="outline" asChild>
              <Link href="/dashboard">Open Portfolio</Link>
            </Button>
          }
        >
          No investments booked as of {asOf || 'today'}. Investments are recorded on a company.
        </EmptyState>
      ) : (
        content
      )}
    </div>
  )
}
