'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { Loader2, Trash2, RefreshCw, Plus, AlertTriangle, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useLedgerFetch } from '@/components/accounting-vehicle'

/**
 * Price feeds: which holdings are priced by a market rather than by judgement.
 *
 * Lives on the schedule of investments because that is where the consequence shows — a feed is
 * what moves a position out of Level 3, and managing it two pages away from the leveling table
 * would make the cause and the effect impossible to see together.
 */

interface Quote {
  as_of_date: string
  price: number
  basis: 'close' | 'intraday' | 'indicative'
  source: string
}

interface Feed {
  id: string
  company_id: string
  kind: 'listed_equity' | 'digital_asset'
  symbol: string
  exchange: string | null
  quote_currency: string
  quote_scale: number
  provider: string
  active_from: string
  active_until: string | null
  restriction_until: string | null
  restriction_discount: number | null
  latestQuote: Quote | null
}

interface QuoteSheet {
  fileId: string | null
  syncedAt: string | null
  lastError: string | null
  googleConnected: boolean
  template: string
}

interface PendingMark {
  companyId: string
  name: string
  symbol: string
  quoteDate: string
  price: number
  shares: number
  derivedCarrying: number
  ledgerCarrying: number
  delta: number
  level: 1 | 2 | 3
}

interface Holding { companyId: string; name: string }

const EMPTY = {
  companyId: '', kind: 'listed_equity', symbol: '', exchange: '',
  quoteCurrency: 'USD', quoteScale: '1', provider: 'google_sheets',
  activeFrom: '', restrictionUntil: '', restrictionDiscount: '',
}

/** A quote's basis in the words the hierarchy uses, so the level is never a bare number. */
function basisNote(q: Quote | null): string {
  if (!q) return 'No quote stored yet'
  if (q.basis === 'close') return `Official close, ${q.as_of_date}`
  if (q.basis === 'intraday') return `Intraday price, ${q.as_of_date} — Level 2, not an official close`
  return `Indicative price, ${q.as_of_date} — Level 2`
}

export function PriceFeedsPanel({ onChanged }: { onChanged?: () => void }) {
  const lf = useLedgerFetch()
  const [feeds, setFeeds] = useState<Feed[]>([])
  const [sheet, setSheet] = useState<QuoteSheet | null>(null)
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [marks, setMarks] = useState<PendingMark[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [sheetUrl, setSheetUrl] = useState('')
  const [showTemplate, setShowTemplate] = useState(false)
  const [quoteFor, setQuoteFor] = useState<string | null>(null)
  const [quoteForm, setQuoteForm] = useState({ asOfDate: '', price: '', basis: 'close' })

  const load = useCallback(async () => {
    setLoading(true)
    const [feedRes, posRes, markRes] = await Promise.all([
      lf('/api/accounting/price-feeds'),
      lf('/api/accounting/investments'),
      lf('/api/accounting/quote-marks'),
    ])
    const feedData = feedRes.ok ? await feedRes.json() : null
    const posData = posRes.ok ? await posRes.json() : null
    const markData = markRes.ok ? await markRes.json() : null
    setFeeds(feedData?.feeds ?? [])
    setSheet(feedData?.quoteSheet ?? null)
    setSheetUrl(feedData?.quoteSheet?.fileId ?? '')
    setHoldings((posData?.positions ?? []).map((p: any) => ({ companyId: p.companyId, name: p.name })))
    setMarks(markData?.marks ?? [])
    setLoading(false)
  }, [lf])
  useEffect(() => { load() }, [load])

  const post = async (body: object) => {
    setBusy(true); setError(null); setNote(null)
    const res = await lf('/api/accounting/price-feeds', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(data.error ?? 'Failed'); return null }
    await load()
    return data
  }

  async function addFeed() {
    const payload: Record<string, unknown> = {
      companyId: form.companyId,
      kind: form.kind,
      symbol: form.symbol.trim(),
      exchange: form.exchange.trim() || null,
      quoteCurrency: form.quoteCurrency.trim().toUpperCase() || 'USD',
      quoteScale: parseFloat(form.quoteScale) || 1,
      provider: form.provider,
      activeFrom: form.activeFrom || null,
      restrictionUntil: form.restrictionUntil || null,
      restrictionDiscount: form.restrictionDiscount ? parseFloat(form.restrictionDiscount) / 100 : null,
    }
    const d = await post(payload)
    if (d) { setAdding(false); setForm({ ...EMPTY }); setNote(`${payload.symbol} is now priced by a feed.`); onChanged?.() }
  }

  async function removeFeed(id: string, symbol: string) {
    setBusy(true); setError(null); setNote(null)
    const res = await lf(`/api/accounting/price-feeds?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) { setError('Could not remove the feed.'); return }
    setNote(`${symbol} is no longer priced by a feed — it marks from its rounds again.`)
    await load(); onChanged?.()
  }

  async function recordQuote(feedId: string) {
    const d = await post({
      action: 'record-quote',
      feedId,
      asOfDate: quoteForm.asOfDate,
      price: parseFloat(quoteForm.price),
      basis: quoteForm.basis,
    })
    if (d) { setQuoteFor(null); setQuoteForm({ asOfDate: '', price: '', basis: 'close' }); onChanged?.() }
  }

  async function syncNow() {
    const d = await post({ action: 'sync-now' })
    if (d) {
      setNote(
        d.stored > 0
          ? `Stored ${d.stored} ${d.stored === 1 ? 'quote' : 'quotes'} from the sheet.`
          : 'The sheet was read, but no quote matched a feed. Check the symbols match.',
      )
      if (d.errors?.length) setError(d.errors.join(' · '))
      onChanged?.()
    }
  }

  async function bookMarks() {
    setBusy(true); setError(null); setNote(null)
    const res = await lf('/api/accounting/quote-marks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(data.error ?? 'Failed'); return }
    setNote(`Drafted ${data.booked} ${data.booked === 1 ? 'mark' : 'marks'} in the journal for review.`)
    if (data.errors?.length) setError(data.errors.join(' · '))
    await load(); onChanged?.()
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />Loading price feeds…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-medium">Price feeds</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Holdings priced by a market rather than by a round. A feed is what makes a position
            Level 1 or 2 in the fair value hierarchy.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding(a => !a)} disabled={busy}>
          <Plus className="h-3.5 w-3.5 mr-1" />Add a feed
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}
      {note && (
        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs flex items-start gap-2">
          <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" /><span>{note}</span>
        </div>
      )}

      {adding && (
        <div className="rounded-lg border p-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <Label className="text-xs">Holding</Label>
              <Select value={form.companyId} onValueChange={v => setForm(f => ({ ...f, companyId: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Pick a holding" /></SelectTrigger>
                <SelectContent>
                  {holdings.map(h => <SelectItem key={h.companyId} value={h.companyId}>{h.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Instrument</Label>
              <Select value={form.kind} onValueChange={v => setForm(f => ({ ...f, kind: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="listed_equity">Listed equity</SelectItem>
                  <SelectItem value="digital_asset">Digital asset</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Priced by</Label>
              <Select value={form.provider} onValueChange={v => setForm(f => ({ ...f, provider: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="google_sheets">Google Finance sheet</SelectItem>
                  <SelectItem value="manual">Entered by hand</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Symbol</Label>
              <Input className="mt-1" value={form.symbol} placeholder="AAPL"
                onChange={e => setForm(f => ({ ...f, symbol: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Exchange</Label>
              <Input className="mt-1" value={form.exchange} placeholder="NASDAQ"
                onChange={e => setForm(f => ({ ...f, exchange: e.target.value }))} />
              <p className="mt-1 text-[11px] text-muted-foreground">
                A ticker alone is ambiguous — the same symbol trades on several venues at different prices.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Quote currency</Label>
                <Input className="mt-1" value={form.quoteCurrency}
                  onChange={e => setForm(f => ({ ...f, quoteCurrency: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Scale</Label>
                <Input className="mt-1" type="number" step="any" value={form.quoteScale}
                  onChange={e => setForm(f => ({ ...f, quoteScale: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Priced from</Label>
              <Input className="mt-1" type="date" value={form.activeFrom}
                onChange={e => setForm(f => ({ ...f, activeFrom: e.target.value }))} />
              <p className="mt-1 text-[11px] text-muted-foreground">
                The listing date, or the day you bought it. Periods before this still mark from the holding&rsquo;s rounds.
              </p>
            </div>
            <div>
              <Label className="text-xs">Lock-up until</Label>
              <Input className="mt-1" type="date" value={form.restrictionUntil}
                onChange={e => setForm(f => ({ ...f, restrictionUntil: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Lock-up discount %</Label>
              <Input className="mt-1" type="number" step="any" value={form.restrictionDiscount}
                placeholder="e.g. 20" onChange={e => setForm(f => ({ ...f, restrictionDiscount: e.target.value }))} />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Applying a discount makes the mark Level 2 — it is no longer the unadjusted quoted price.
              </p>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            A quote scale of 100 is for a listing quoted in pence (GBp) rather than pounds. Read unscaled it is
            off by 100&times; and looks entirely plausible.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={addFeed} disabled={busy || !form.companyId || !form.symbol || !form.activeFrom}>
              Add feed
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setForm({ ...EMPTY }) }}>Cancel</Button>
          </div>
        </div>
      )}

      {feeds.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No feeds yet. Every holding is Level 3 — valued by judgement — which is right for a wholly private book.
        </p>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-3 py-2 font-medium">Symbol</th>
                <th className="text-left px-3 py-2 font-medium">Priced by</th>
                <th className="text-left px-3 py-2 font-medium">Priced from</th>
                <th className="text-right px-3 py-2 font-medium">Latest quote</th>
                <th className="text-left px-3 py-2 font-medium">Basis</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {feeds.map(f => (
                <Fragment key={f.id}>
                  <tr className="border-b last:border-b-0">
                    <td className="px-3 py-2">
                      <span className="font-medium">{f.exchange ? `${f.exchange}:${f.symbol}` : f.symbol}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {holdings.find(h => h.companyId === f.company_id)?.name ?? ''}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {f.provider === 'google_sheets' ? 'Google Finance sheet' : 'By hand'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">{f.active_from}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {f.latestQuote
                        ? `${(f.latestQuote.price / (f.quote_scale || 1)).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${f.quote_currency}`
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{basisNote(f.latestQuote)}</td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" className="text-xs h-7"
                        onClick={() => setQuoteFor(quoteFor === f.id ? null : f.id)}>
                        Enter a quote
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7" disabled={busy}
                        onClick={() => removeFeed(f.id, f.symbol)} aria-label={`Remove the ${f.symbol} feed`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                  {quoteFor === f.id && (
                    <tr className="border-b bg-muted/20">
                      <td colSpan={6} className="px-3 py-3">
                        <div className="flex flex-wrap items-end gap-3">
                          <div>
                            <Label className="text-xs">Market date</Label>
                            <Input className="mt-1 w-40" type="date" value={quoteForm.asOfDate}
                              onChange={e => setQuoteForm(q => ({ ...q, asOfDate: e.target.value }))} />
                          </div>
                          <div>
                            <Label className="text-xs">Price ({f.quote_currency})</Label>
                            <Input className="mt-1 w-32" type="number" step="any" value={quoteForm.price}
                              onChange={e => setQuoteForm(q => ({ ...q, price: e.target.value }))} />
                          </div>
                          <div>
                            <Label className="text-xs">Basis</Label>
                            <Select value={quoteForm.basis} onValueChange={v => setQuoteForm(q => ({ ...q, basis: v }))}>
                              <SelectTrigger className="mt-1 w-40"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="close">Official close</SelectItem>
                                <SelectItem value="intraday">Intraday</SelectItem>
                                <SelectItem value="indicative">Indicative</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <Button size="sm" disabled={busy || !quoteForm.asOfDate || !quoteForm.price}
                            onClick={() => recordQuote(f.id)}>Save quote</Button>
                        </div>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          Only an official close earns Level 1. Re-entering a date replaces that day&rsquo;s quote
                          rather than adding a second one.
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* --- Pending marks ------------------------------------------------ */}
      {marks.length > 0 && (
        <div className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">
                {marks.length} {marks.length === 1 ? 'mark is' : 'marks are'} not booked
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                The close blocks until these are in the ledger — it is the control total the schedule ties to.
                Booking drafts them in the journal for review; nothing posts itself.
              </p>
            </div>
            <Button size="sm" onClick={bookMarks} disabled={busy}>Book them</Button>
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            {marks.map(m => (
              <div key={m.companyId} className="tabular-nums">
                {m.name} ({m.symbol}): ledger carries {m.ledgerCarrying.toLocaleString('en-US', { maximumFractionDigits: 2 })},
                {' '}{m.shares.toLocaleString('en-US')} units at {m.price} on {m.quoteDate} value at{' '}
                {m.derivedCarrying.toLocaleString('en-US', { maximumFractionDigits: 2 })} — Level {m.level}.
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --- The Google sheet --------------------------------------------- */}
      <div className="rounded-lg border p-3 space-y-3">
        <div>
          <p className="text-sm font-medium">Google Finance sheet</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Google retired its Finance API in 2012, so the only way to that data is the{' '}
            <code className="text-[11px]">GOOGLEFINANCE()</code> formula inside a sheet. Keep one sheet of
            those formulas and this reads its values each weekday evening. It needs no new Google permission —
            your existing Drive connection covers it.
          </p>
        </div>

        {!sheet?.googleConnected && (
          <div className="rounded border px-3 py-2 text-xs flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Google isn&rsquo;t connected for this fund yet — connect it in Settings before using a sheet.</span>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[16rem]">
            <Label className="text-xs">Sheet link</Label>
            <Input className="mt-1" value={sheetUrl} placeholder="https://docs.google.com/spreadsheets/d/…"
              onChange={e => setSheetUrl(e.target.value)} />
          </div>
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => post({ action: 'set-sheet', url: sheetUrl })}>Save</Button>
          <Button size="sm" variant="outline" disabled={busy || !sheet?.fileId} onClick={syncNow}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />Sync now
          </Button>
        </div>

        {sheet?.syncedAt && (
          <p className="text-xs text-muted-foreground">
            Last synced {new Date(sheet.syncedAt).toLocaleString()}.
          </p>
        )}
        {sheet?.lastError && (
          <div className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /><span>{sheet.lastError}</span>
          </div>
        )}

        <div>
          <Button size="sm" variant="ghost" className="text-xs h-7 px-0"
            onClick={() => setShowTemplate(t => !t)}>
            {showTemplate ? 'Hide' : 'Show'} the sheet template
          </Button>
          {showTemplate && sheet && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-muted-foreground">
                Paste this into the first two rows of a new sheet, then replace the ticker and add one row per
                holding. It reads the last <em>trading day&rsquo;s</em> official close with its real date, so
                weekends and holidays take care of themselves — and it earns Level 1, which a bare delayed
                quote would not.
              </p>
              <pre className="text-[11px] bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre">{sheet.template}</pre>
              <p className="text-[11px] text-muted-foreground">
                Splits are not in this data. Enter a share split on the holding&rsquo;s page — otherwise the
                share count stays pre-split while the price goes post-split and the position halves.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
