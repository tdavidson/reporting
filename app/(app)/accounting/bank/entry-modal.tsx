'use client'

import { useEffect, useState } from 'react'
import { Loader2, X, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'

interface Acct { id: string; code: string; name: string; lp_entity_id: string | null }
interface PostingRow { id: string; account_id: string; amount: number; lp_entity_id: string | null }
interface Line { key: string; accountId: string; debit: string; credit: string; lpEntityId: string | null }

let seq = 0
const newLine = (): Line => ({ key: `l${seq++}`, accountId: '', debit: '', credit: '', lpEntityId: null })
const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : 0 }

/**
 * Edit a drafted journal entry inline — the double-entry lines behind a bank
 * transaction. Change accounts/amounts, add or remove lines, and save (or save
 * and post) without the two-step suggest-then-post flow. Draft entries only.
 */
export function EntryModal({ txnId, entryId, onClose, onSaved }: { txnId: string; entryId: string; onClose: () => void; onSaved: () => void }) {
  const lf = useLedgerFetch()
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<Acct[]>([])
  const [date, setDate] = useState('')
  const [memo, setMemo] = useState('')
  const [lines, setLines] = useState<Line[]>([])

  useEffect(() => {
    Promise.all([
      lf(`/api/accounting/journal?id=${entryId}`).then(r => (r.ok ? r.json() : null)),
      lf('/api/accounting/chart').then(r => (r.ok ? r.json() : [])),
    ]).then(([entry, chart]) => {
      setAccounts(Array.isArray(chart) ? chart : [])
      if (entry) {
        setDate(entry.entry_date ?? '')
        setMemo(entry.memo ?? '')
        setLines((entry.journal_postings ?? []).map((p: PostingRow) => {
          const amt = Number(p.amount)
          return { key: `l${seq++}`, accountId: p.account_id, debit: amt > 0 ? String(amt) : '', credit: amt < 0 ? String(-amt) : '', lpEntityId: p.lp_entity_id }
        }))
      }
    }).finally(() => setLoading(false))
  }, [lf, entryId])

  const acctById = new Map(accounts.map(a => [a.id, a]))
  const selectable = accounts.filter(a => !a.lp_entity_id) // regular chart accounts (not per-LP capital)

  const totalDebit = lines.reduce((s, l) => s + num(l.debit), 0)
  const totalCredit = lines.reduce((s, l) => s + num(l.credit), 0)
  const diff = Math.round((totalDebit - totalCredit) * 100) / 100
  const balanced = diff === 0 && lines.length >= 2 && lines.every(l => l.accountId && (num(l.debit) > 0 || num(l.credit) > 0))

  const update = (key: string, patch: Partial<Line>) => setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)))

  async function save(thenPost: boolean) {
    setSaving(true); setError(null)
    const postings = lines.map(l => ({ accountId: l.accountId, amount: num(l.debit) > 0 ? num(l.debit) : -num(l.credit), lpEntityId: l.lpEntityId }))
    const res = await lf('/api/accounting/journal', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: entryId, entryDate: date, memo, postings }) })
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? 'Save failed'); setSaving(false); return }
    if (thenPost) {
      const p = await lf('/api/accounting/bank', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'post', id: txnId }) })
      if (!p.ok) { setError((await p.json().catch(() => ({}))).error ?? 'Saved, but posting failed'); setSaving(false); return }
    }
    setSaving(false); onSaved(); onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-lg border bg-card shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-medium">Edit journal entry</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : (
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap gap-3">
              <label className="text-xs text-muted-foreground">Date
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className="mt-0.5 block rounded border border-input bg-transparent px-2 py-1 text-sm" />
              </label>
              <label className="min-w-[200px] flex-1 text-xs text-muted-foreground">Memo
                <input value={memo} onChange={e => setMemo(e.target.value)} className="mt-0.5 block w-full rounded border border-input bg-transparent px-2 py-1 text-sm" />
              </label>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-1 font-medium">Account</th>
                  <th className="w-28 pb-1 text-right font-medium">Debit</th>
                  <th className="w-28 pb-1 text-right font-medium">Credit</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map(l => {
                  const locked = !!l.lpEntityId
                  return (
                    <tr key={l.key}>
                      <td className="py-1 pr-2">
                        {locked ? (
                          <span className="text-xs">{acctById.get(l.accountId)?.name ?? 'LP capital'}</span>
                        ) : (
                          <select value={l.accountId} onChange={e => update(l.key, { accountId: e.target.value })} className="w-full rounded border border-input bg-transparent px-1.5 py-1 text-xs">
                            <option value="">Select account…</option>
                            {selectable.map(a => <option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}
                          </select>
                        )}
                      </td>
                      <td className="px-1 py-1"><input inputMode="decimal" value={l.debit} onChange={e => update(l.key, { debit: e.target.value, credit: '' })} className="w-full rounded border border-input bg-transparent px-1.5 py-1 text-right font-mono text-xs" /></td>
                      <td className="px-1 py-1"><input inputMode="decimal" value={l.credit} onChange={e => update(l.key, { credit: e.target.value, debit: '' })} className="w-full rounded border border-input bg-transparent px-1.5 py-1 text-right font-mono text-xs" /></td>
                      <td className="py-1 text-right">{!locked && <button onClick={() => setLines(prev => prev.filter(x => x.key !== l.key))} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t text-xs">
                  <td className="pt-1"><button onClick={() => setLines(prev => [...prev, newLine()])} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><Plus className="h-3.5 w-3.5" /> Add line</button></td>
                  <td className="pt-1 text-right font-mono">{fmt(totalDebit)}</td>
                  <td className="pt-1 text-right font-mono">{fmt(totalCredit)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>

            <div className="flex items-center justify-between">
              <span className={`text-xs ${diff === 0 ? 'text-muted-foreground' : 'text-amber-600'}`}>{diff === 0 ? 'Balanced' : `Out of balance by ${fmt(Math.abs(diff))}`}</span>
              {error && <span className="text-xs text-destructive">{error}</span>}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
              <Button size="sm" variant="outline" onClick={() => save(false)} disabled={saving || !balanced}>{saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Save draft</Button>
              <Button size="sm" onClick={() => save(true)} disabled={saving || !balanced}>Save &amp; post</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
