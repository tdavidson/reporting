'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Check, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'

interface LpRow {
  lpEntityId: string
  name: string
  commitment: number
  called: number
  funded: number
  outstanding: number
  receivable: number
  ending: number
}
interface CallLine { lpEntityId: string; name: string; amount: number }
interface CallRow { id: string; callDate: string; description: string | null; scope: string; total: number; lines: CallLine[] }

export function CapitalCallsView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const lf = useLedgerFetch()

  const [summary, setSummary] = useState<LpRow[]>([])
  const [calls, setCalls] = useState<CallRow[]>([])
  const [loading, setLoading] = useState(true)

  const [mode, setMode] = useState<'fund_wide' | 'per_lp'>('fund_wide')
  const [callDate, setCallDate] = useState('')
  const [description, setDescription] = useState('')
  const [total, setTotal] = useState('')
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [issuing, setIssuing] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    lf('/api/accounting/capital-calls')
      .then(r => (r.ok ? r.json() : { summary: [], calls: [] }))
      .then(d => { setSummary(d.summary ?? []); setCalls(d.calls ?? []) })
      .finally(() => setLoading(false))
  }, [lf])
  useEffect(() => { load() }, [load])

  const enteredTotal = summary.reduce((s, r) => s + (Number(amounts[r.lpEntityId]) || 0), 0)

  async function splitProRata() {
    const t = Number(total)
    if (!Number.isFinite(t) || t <= 0) { setMsg({ ok: false, text: 'Enter a positive total to split' }); return }
    const res = await lf('/api/accounting/capital-calls', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'preview', total: t }),
    })
    const data = await res.json()
    if (!res.ok) { setMsg({ ok: false, text: data.error ?? 'Could not split' }); return }
    const next: Record<string, string> = {}
    for (const l of (data.lines ?? [])) next[l.lpEntityId] = String(l.amount)
    setAmounts(next)
    setMsg(null)
  }

  async function issue() {
    setMsg(null)
    const lines = summary
      .map(r => ({ lpEntityId: r.lpEntityId, amount: Number(amounts[r.lpEntityId]) || 0 }))
      .filter(l => l.amount > 0)
    if (lines.length === 0) { setMsg({ ok: false, text: 'Enter at least one LP amount' }); return }
    if (!callDate) { setMsg({ ok: false, text: 'Pick a call date' }); return }
    setIssuing(true)
    const res = await lf('/api/accounting/capital-calls', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'issue', callDate, description: description || null, scope: mode, lines }),
    })
    const data = await res.json()
    setIssuing(false)
    if (!res.ok) { setMsg({ ok: false, text: data.error ?? 'Could not issue call' }); return }
    setMsg({ ok: true, text: 'Call issued.' })
    setAmounts({}); setTotal(''); setDescription('')
    load()
  }

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>

  return (
    <div className="space-y-8">
      {/* LP commitment / called / funded / outstanding */}
      <div>
        <p className="text-sm font-medium mb-2">LP capital</p>
        {summary.length === 0 ? (
          <div className="border border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground">
            No LPs found for this vehicle. Add investors/commitments (they come from your LP data) first.
          </div>
        ) : (
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-3 py-2 font-medium">LP</th>
                  <th className="text-right px-3 py-2 font-medium">Commitment</th>
                  <th className="text-right px-3 py-2 font-medium">Called</th>
                  <th className="text-right px-3 py-2 font-medium">Funded</th>
                  <th className="text-right px-3 py-2 font-medium">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {summary.map(r => (
                  <tr key={r.lpEntityId} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.commitment)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.called)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.funded)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/30 font-semibold">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(summary.reduce((s, r) => s + r.commitment, 0))}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(summary.reduce((s, r) => s + r.called, 0))}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(summary.reduce((s, r) => s + r.funded, 0))}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(summary.reduce((s, r) => s + r.outstanding, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Issue a call */}
      {summary.length > 0 && (
        <div className="border rounded-lg p-4 space-y-3">
          <p className="text-sm font-medium">Issue a call</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted-foreground">Date
              <input type="date" value={callDate} onChange={e => setCallDate(e.target.value)} className="block mt-1 border border-input rounded px-2 py-1.5 text-sm bg-transparent" />
            </label>
            <label className="text-xs text-muted-foreground flex-1 min-w-[180px]">Description
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Call #3 — new investment" className="block mt-1 w-full border border-input rounded px-2 py-1.5 text-sm bg-transparent" />
            </label>
            <div className="text-xs text-muted-foreground">
              <span className="block mb-1">Type</span>
              <div className="inline-flex rounded border border-input overflow-hidden">
                <button type="button" onClick={() => setMode('fund_wide')} className={`px-2.5 py-1.5 text-xs ${mode === 'fund_wide' ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}>Fund-wide</button>
                <button type="button" onClick={() => setMode('per_lp')} className={`px-2.5 py-1.5 text-xs border-l border-input ${mode === 'per_lp' ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}>Per-LP</button>
              </div>
            </div>
          </div>

          {mode === 'fund_wide' && (
            <div className="flex items-end gap-2">
              <label className="text-xs text-muted-foreground">Total to call
                <input value={total} onChange={e => setTotal(e.target.value)} inputMode="decimal" placeholder="0.00" className="block mt-1 border border-input rounded px-2 py-1.5 text-sm font-mono bg-transparent w-40" />
              </label>
              <Button size="sm" variant="outline" onClick={splitProRata}>Split pro-rata</Button>
              <span className="text-xs text-muted-foreground pb-2">Fills each LP by commitment — edit any row below.</span>
            </div>
          )}

          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-3 py-2 font-medium">LP</th>
                  <th className="text-right px-3 py-2 font-medium">Commitment</th>
                  <th className="text-right px-3 py-2 font-medium">Outstanding</th>
                  <th className="text-right px-3 py-2 font-medium">Call amount</th>
                </tr>
              </thead>
              <tbody>
                {summary.map(r => (
                  <tr key={r.lpEntityId} className="border-b last:border-b-0">
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">{fmt(r.commitment)}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">{fmt(r.outstanding)}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        value={amounts[r.lpEntityId] ?? ''}
                        onChange={e => setAmounts(a => ({ ...a, [r.lpEntityId]: e.target.value }))}
                        inputMode="decimal"
                        placeholder="0.00"
                        className="border border-input rounded px-2 py-1 text-sm font-mono bg-transparent w-32 text-right"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/30 font-semibold">
                  <td className="px-3 py-2" colSpan={3}>Call total</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(enteredTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={issue} disabled={issuing || enteredTotal <= 0}>
              {issuing && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Issue call
            </Button>
            {msg && (
              <span className={`text-sm flex items-center gap-1 ${msg.ok ? 'text-green-600' : 'text-amber-600'}`}>
                {msg.ok ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{msg.text}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Call history */}
      {calls.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">Issued calls</p>
          <div className="space-y-2">
            {calls.map(c => (
              <div key={c.id} className="border rounded-lg p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{c.callDate} · {fmt(c.total)}</span>
                  <span className="text-xs text-muted-foreground">{c.scope === 'fund_wide' ? 'Fund-wide' : 'Per-LP'}</span>
                </div>
                {c.description && <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>}
                <div className="mt-2 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5">
                  {c.lines.map(l => <span key={l.lpEntityId}>{l.name}: <span className="font-mono">{fmt(l.amount)}</span></span>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
