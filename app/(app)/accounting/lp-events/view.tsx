'use client'

// LP capital events for one vehicle.
//
// Everything on this screen speaks in capital deltas the way a human would: "Acme contributed
// $100,000" is +100,000. The debit-positive storage convention lives in lib/accounting/lp-events.ts
// and never surfaces here.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Upload, Trash2, Pencil, X, Check, BookOpen, ListTree, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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

export function LpEventsView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const lf = useLedgerFetch()

  const [source, setSource] = useState<'ledger' | 'events'>('events')
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
      setSource(d.source)
      setEvents(d.events ?? [])
      setRoster(d.roster ?? [])
      setTypes(d.types ?? [])
    }
    setLoading(false)
  }, [lf])
  useEffect(() => { load() }, [load])

  const typeLabel = useMemo(
    () => new Map(types.map(t => [t.value, t.label])),
    [types]
  )

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

  const setCapitalSource = async (next: 'ledger' | 'events') => {
    const ok = await call('/api/accounting/lp-events', 'PATCH', { capitalSource: next })
    if (ok) { setSource(next); load() }
  }

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
    if (ok) { setForm(EMPTY_FORM); setShowForm(false); setEditingId(null); load() }
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
    if (ok) load()
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
    if (ok) { setShowImport(false); setPasted(''); setPreview(null); load() }
  }

  const runningTotal = useMemo(
    () => Math.round(events.reduce((s, e) => s + e.capitalDelta, 0) * 100) / 100,
    [events]
  )

  if (loading) {
    return <div className="flex items-center py-16 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" />Loading…</div>
  }

  const isLedger = source === 'ledger'

  return (
    <div className="space-y-6">
      {/* Which producer this vehicle reads from. The single most important thing on the page:
          if it says "ledger", nothing entered below is being used. */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                {isLedger ? <BookOpen className="h-4 w-4" /> : <ListTree className="h-4 w-4" />}
                This vehicle&rsquo;s LP capital comes from{' '}
                <Badge variant={isLedger ? 'default' : 'secondary'}>
                  {isLedger ? 'the ledger' : 'capital events'}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground max-w-2xl">
                {isLedger
                  ? 'Its capital accounts are derived from posted journal entries. Events entered here are kept, but ignored — a vehicle reads from exactly one source, because reading both would double every LP’s capital.'
                  : 'Its capital accounts are derived from the events below. Switch to the ledger once you have seeded a chart of accounts and booked its history.'}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setCapitalSource(isLedger ? 'events' : 'ledger')}
            >
              Use {isLedger ? 'capital events' : 'the ledger'} instead
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-md p-3">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => { setShowForm(v => !v); setEditingId(null); setForm(EMPTY_FORM) }}>
          <Plus className="h-4 w-4 mr-1" /> Add event
        </Button>
        <Button size="sm" variant="outline" onClick={() => { setShowImport(v => !v); setPreview(null) }}>
          <Upload className="h-4 w-4 mr-1" /> Import
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
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">LP</label>
                <select
                  className="w-full h-9 rounded-md border bg-background px-2 text-sm"
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
                  className="w-full h-9 rounded-md border bg-background px-2 text-sm"
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
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
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
          <CardContent className="p-4 space-y-3">
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
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Preview
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowImport(false); setPasted(''); setPreview(null) }}>
                Cancel
              </Button>
            </div>

            {preview && (
              <div className="space-y-3 pt-2">
                {preview.errors.length > 0 && (
                  <div className="text-sm border border-amber-300 bg-amber-50 dark:bg-amber-950/20 rounded-md p-3 space-y-1">
                    <div className="font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4" />
                      {preview.errors.length} row{preview.errors.length === 1 ? '' : 's'} not imported
                    </div>
                    <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
                      {preview.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}
                {preview.rows.length > 0 ? (
                  <>
                    <div className="border rounded-md overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40">
                          <tr>
                            <th className="text-left font-medium p-2">LP</th>
                            <th className="text-left font-medium p-2">Date</th>
                            <th className="text-left font-medium p-2">Type</th>
                            <th className="text-right font-medium p-2">Amount</th>
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
                      {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
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
          <CardContent className="p-8 text-center text-muted-foreground text-sm">
            No capital events yet. Add one, or paste a history from a spreadsheet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left font-medium p-3">LP</th>
                  <th className="text-left font-medium p-3">Date</th>
                  <th className="text-left font-medium p-3">Type</th>
                  <th className="text-right font-medium p-3">Amount</th>
                  <th className="text-left font-medium p-3">Memo</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {events.map(e => (
                  <tr key={e.id} className="border-b hover:bg-muted/20">
                    <td className="p-3 font-medium">{e.lpName}</td>
                    <td className="p-3 text-muted-foreground tabular-nums">{e.eventDate}</td>
                    <td className="p-3 text-muted-foreground">{typeLabel.get(e.sourceType) ?? e.sourceType}</td>
                    <td className={`p-3 text-right tabular-nums ${e.capitalDelta < 0 ? 'text-red-600' : ''}`}>
                      {fmt(e.capitalDelta)}
                    </td>
                    <td className="p-3 text-muted-foreground text-xs">{e.memo}</td>
                    <td className="p-3">
                      <div className="flex gap-1 justify-end">
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
