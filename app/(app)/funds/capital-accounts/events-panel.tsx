'use client'

// The entry surface for a capital-tracking-only vehicle — what the Journal is to a booked
// one. Only rendered when the vehicle's capital_source is 'events'; the roll-forward above
// it on the page is computed from exactly these rows.
//
// Everything here speaks in capital deltas the way a human would: "Acme contributed $100,000"
// is +100,000. The debit-positive storage convention lives in lib/accounting/lp-events.ts and
// never surfaces here.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Upload, Trash2, Pencil, Check, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'

interface EventType { value: string; label: string; hint: string }
interface LpEvent {
  id: string
  lpEntityId: string
  lpName: string
  eventDate: string
  sourceType: string
  capitalDelta: number
  memo: string | null
}
interface Roster { id: string; name: string }

interface ParsedRow {
  lpEntityId: string
  lpName: string
  eventDate: string
  sourceType: string
  capitalDelta: number
  memo: string | null
  line: number
}

const EMPTY_FORM = { lpEntityId: '', eventDate: '', sourceType: 'capital_call', amount: '', memo: '' }

/** `onChange` reloads the roll-forward on the page above — these rows are its inputs. */
export function EventsPanel({ onChange }: { onChange: () => void }) {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const lf = useLedgerFetch()

  const [events, setEvents] = useState<LpEvent[]>([])
  const [roster, setRoster] = useState<Roster[]>([])
  const [types, setTypes] = useState<EventType[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [showImport, setShowImport] = useState(false)
  const [pasted, setPasted] = useState('')
  const [preview, setPreview] = useState<{ rows: ParsedRow[]; errors: string[] } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await lf('/api/accounting/lp-events')
    if (res.ok) {
      const d = await res.json()
      setEvents(d.events ?? [])
      setRoster(d.roster ?? [])
      setTypes(d.types ?? [])
    }
    setLoading(false)
  }, [lf])
  useEffect(() => { load() }, [load])

  const typeLabel = useMemo(() => new Map(types.map(t => [t.value, t.label])), [types])

  const call = async (url: string, method: string, body?: object) => {
    setBusy(true); setError(null)
    const res = await lf(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(data.error || 'Something went wrong'); return null }
    return data
  }

  /** Reload the events table AND the roll-forward the page renders from them. */
  const refresh = () => { load(); onChange() }

  const submitForm = async () => {
    const amount = Number(form.amount)
    if (!form.lpEntityId || !form.eventDate || !Number.isFinite(amount) || amount === 0) {
      setError('Pick an LP, a date, and a non-zero amount.')
      return
    }
    const event = {
      lpEntityId: form.lpEntityId,
      eventDate: form.eventDate,
      sourceType: form.sourceType,
      capitalDelta: amount,
      memo: form.memo || null,
    }
    const ok = editingId
      ? await call('/api/accounting/lp-events', 'PUT', { id: editingId, event })
      : await call('/api/accounting/lp-events', 'POST', { event })
    if (ok) { setForm(EMPTY_FORM); setShowForm(false); setEditingId(null); refresh() }
  }

  const startEdit = (e: LpEvent) => {
    setEditingId(e.id)
    setForm({
      lpEntityId: e.lpEntityId,
      eventDate: e.eventDate,
      sourceType: e.sourceType,
      amount: String(e.capitalDelta),
      memo: e.memo ?? '',
    })
    setShowForm(true)
  }

  const remove = async (id: string) => {
    const ok = await call(`/api/accounting/lp-events?id=${id}`, 'DELETE')
    if (ok) refresh()
  }

  const runPreview = async () => {
    const d = await call('/api/accounting/lp-events/import', 'POST', { text: pasted })
    if (d) setPreview({ rows: d.rows ?? [], errors: d.errors ?? [] })
  }

  const commitImport = async () => {
    if (!preview?.rows.length) return
    const ok = await call('/api/accounting/lp-events', 'POST', {
      events: preview.rows.map(r => ({
        lpEntityId: r.lpEntityId,
        eventDate: r.eventDate,
        sourceType: r.sourceType,
        capitalDelta: r.capitalDelta,
        memo: r.memo,
      })),
    })
    if (ok) { setShowImport(false); setPasted(''); setPreview(null); refresh() }
  }

  const runningTotal = useMemo(
    () => Math.round(events.reduce((s, e) => s + e.capitalDelta, 0) * 100) / 100,
    [events]
  )

  if (loading) {
    return (
      <div className="flex items-center py-8 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading capital events…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium">Capital events</p>
        <p className="text-xs text-muted-foreground">
          Every movement in an LP&rsquo;s capital on this vehicle. The roll-forward above is the sum of these.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => { setShowForm(v => !v); setEditingId(null); setForm(EMPTY_FORM) }}>
          <Plus className="mr-1 h-4 w-4" /> Add event
        </Button>
        <Button size="sm" variant="outline" onClick={() => { setShowImport(v => !v); setPreview(null) }}>
          <Upload className="mr-1 h-4 w-4" /> Import
        </Button>
        <span className="flex-1" />
        {events.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {events.length} event{events.length === 1 ? '' : 's'} · net{' '}
            <span className="font-medium tabular-nums text-foreground">{fmt(runningTotal)}</span>
          </span>
        )}
      </div>

      {showForm && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">LP</label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={form.lpEntityId}
                  onChange={e => setForm(f => ({ ...f, lpEntityId: e.target.value }))}
                >
                  <option value="">Select…</option>
                  {roster.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Date</label>
                <Input type="date" value={form.eventDate} onChange={e => setForm(f => ({ ...f, eventDate: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Type</label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={form.sourceType}
                  onChange={e => setForm(f => ({ ...f, sourceType: e.target.value }))}
                >
                  {types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Amount</label>
                <Input
                  type="number"
                  placeholder="100000"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Memo</label>
                <Input value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} />
              </div>
            </div>
            {/* Sign is the thing people get wrong, so say it plainly rather than relying on a
                convention they have to remember. */}
            <p className="text-xs text-muted-foreground">
              Positive increases the LP&rsquo;s capital (a contribution, a gain). Negative reduces it
              (a distribution, a fee, a markdown).
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={submitForm} disabled={busy}>
                {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
                {editingId ? 'Save' : 'Add'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM) }}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {showImport && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="text-sm font-medium">Paste rows from a spreadsheet</div>
            <p className="text-xs text-muted-foreground">
              Needs a header row with <span className="font-mono">LP</span>,{' '}
              <span className="font-mono">Date</span>, <span className="font-mono">Type</span>,{' '}
              <span className="font-mono">Amount</span> (Memo optional). Amounts can be plain
              magnitudes &mdash; a distribution or fee is understood to reduce capital. Nothing is
              saved until you review the preview.
            </p>
            <Textarea
              rows={6}
              className="font-mono text-xs"
              placeholder={'LP,Date,Type,Amount,Memo\nAcme Capital,2026-01-15,Capital Call,1000000,Initial drawdown'}
              value={pasted}
              onChange={e => setPasted(e.target.value)}
            />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={runPreview} disabled={busy || !pasted.trim()}>
                {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Preview
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowImport(false); setPasted(''); setPreview(null) }}>
                Cancel
              </Button>
            </div>

            {preview && (
              <div className="space-y-3 pt-2">
                {preview.errors.length > 0 && (
                  <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/20">
                    <div className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-4 w-4" />
                      {preview.errors.length} row{preview.errors.length === 1 ? '' : 's'} not imported
                    </div>
                    <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                      {preview.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}
                {preview.rows.length > 0 ? (
                  <>
                    <div className="overflow-hidden rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40">
                          <tr>
                            <th className="p-2 text-left font-medium">LP</th>
                            <th className="p-2 text-left font-medium">Date</th>
                            <th className="p-2 text-left font-medium">Type</th>
                            <th className="p-2 text-right font-medium">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.rows.map(r => (
                            <tr key={r.line} className="border-t">
                              <td className="p-2">{r.lpName}</td>
                              <td className="p-2 text-muted-foreground">{r.eventDate}</td>
                              <td className="p-2 text-muted-foreground">{typeLabel.get(r.sourceType) ?? r.sourceType}</td>
                              <td className={`p-2 text-right tabular-nums ${r.capitalDelta < 0 ? 'text-red-600' : ''}`}>
                                {fmt(r.capitalDelta)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Button size="sm" onClick={commitImport} disabled={busy}>
                      {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
                      Import {preview.rows.length} event{preview.rows.length === 1 ? '' : 's'}
                    </Button>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">Nothing to import.</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {events.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No capital events yet. Add one, or paste a history from a spreadsheet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="p-3 text-left font-medium">LP</th>
                  <th className="p-3 text-left font-medium">Date</th>
                  <th className="p-3 text-left font-medium">Type</th>
                  <th className="p-3 text-right font-medium">Amount</th>
                  <th className="p-3 text-left font-medium">Memo</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {events.map(e => (
                  <tr key={e.id} className="border-b hover:bg-muted/20">
                    <td className="p-3 font-medium">{e.lpName}</td>
                    <td className="p-3 tabular-nums text-muted-foreground">{e.eventDate}</td>
                    <td className="p-3 text-muted-foreground">{typeLabel.get(e.sourceType) ?? e.sourceType}</td>
                    <td className={`p-3 text-right tabular-nums ${e.capitalDelta < 0 ? 'text-red-600' : ''}`}>
                      {fmt(e.capitalDelta)}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{e.memo}</td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(e)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600" onClick={() => remove(e.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
