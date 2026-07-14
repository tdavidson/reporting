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
 * The one editor for a journal entry, wherever it came from.
 *
 * - From the Bank page: pass `txnId` so posting/unposting also keeps the bank
 *   transaction's status in step.
 * - From the Journal page: omit `txnId`; it posts/unposts through the journal API.
 * - With no `entryId` at all: a blank NEW entry.
 *
 * `readOnly` opens a posted entry for viewing without reverting it; unposting from
 * there flips this same modal into edit mode.
 */
export function EntryModal({
  txnId,
  entryId,
  readOnly = false,
  onClose,
  onSaved,
}: {
  txnId?: string
  entryId?: string | null
  readOnly?: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const lf = useLedgerFetch()
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)

  const isNew = !entryId
  const [id, setId] = useState<string | null>(entryId ?? null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<Acct[]>([])
  const [date, setDate] = useState('')
  const [memo, setMemo] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [editable, setEditable] = useState(!readOnly)

  useEffect(() => {
    Promise.all([
      entryId ? lf(`/api/accounting/journal?id=${entryId}`).then(r => (r.ok ? r.json() : null)) : Promise.resolve(null),
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
      } else {
        // New entry: today's date and the two lines every entry needs at minimum.
        setDate(new Date().toISOString().slice(0, 10))
        setLines([newLine(), newLine()])
      }
    }).finally(() => setLoading(false))
  }, [lf, entryId])

  const acctById = new Map(accounts.map(a => [a.id, a]))
  // Both kinds are selectable. A per-LP capital account carries its own lp_entity_id,
  // so choosing one is how you set (or change) the partner on that line.
  const general = accounts.filter(a => !a.lp_entity_id)
  const partnerAccounts = accounts.filter(a => a.lp_entity_id)

  const totalDebit = lines.reduce((s, l) => s + num(l.debit), 0)
  const totalCredit = lines.reduce((s, l) => s + num(l.credit), 0)
  const diff = Math.round((totalDebit - totalCredit) * 100) / 100
  const balanced = diff === 0 && lines.length >= 2 && lines.every(l => l.accountId && (num(l.debit) > 0 || num(l.credit) > 0))

  const update = (key: string, patch: Partial<Line>) => setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)))

  const json = (body: object) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const errOf = async (r: Response, fallback: string) => (await r.json().catch(() => ({}))).error ?? fallback

  /**
   * Post or unpost. A bank-sourced entry goes through the bank API so the
   * transaction's status stays in step with the entry; a standalone journal entry
   * goes straight to the journal API. Both end in the same ledger state.
   */
  async function setPosted(action: 'post' | 'unpost', targetId: string): Promise<string | null> {
    const res = txnId
      ? await lf('/api/accounting/bank', json({ action, id: txnId }))
      : await lf('/api/accounting/journal', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id: targetId }) })
    return res.ok ? null : await errOf(res, `${action} failed`)
  }

  async function save(thenPost: boolean) {
    setSaving(true); setError(null)
    const postings = lines.map(l => ({ accountId: l.accountId, amount: num(l.debit) > 0 ? num(l.debit) : -num(l.credit), lpEntityId: l.lpEntityId }))

    // Create on first save; update thereafter. Always saved as a DRAFT first, so
    // posting is a separate, explicit step — same as every other path.
    let targetId = id
    if (!targetId) {
      const res = await lf('/api/accounting/journal', json({ entryDate: date, memo, sourceType: 'manual', status: 'draft', postings }))
      if (!res.ok) { setError(await errOf(res, 'Could not create the entry')); setSaving(false); return }
      targetId = (await res.json()).id
      setId(targetId)
    } else {
      const res = await lf('/api/accounting/journal', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: targetId, entryDate: date, memo, postings }) })
      if (!res.ok) { setError(await errOf(res, 'Save failed')); setSaving(false); return }
    }

    if (thenPost && targetId) {
      const err = await setPosted('post', targetId)
      if (err) { setError(`Saved as a draft, but posting failed: ${err}`); setSaving(false); return }
    }
    setSaving(false); onSaved(); onClose()
  }

  // Revert the entry to draft and stay open in edit mode — the read-only view's
  // way in. Refuses on a closed period, which surfaces as the API error.
  async function unpostAndEdit() {
    if (!id) return
    setSaving(true); setError(null)
    const err = await setPosted('unpost', id)
    if (err) { setError(err); setSaving(false); return }
    setSaving(false); setEditable(true); onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-lg border bg-card shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-medium">{isNew ? 'New journal entry' : editable ? 'Edit journal entry' : 'Journal entry'}</h2>
          <div className="flex items-center gap-2">
            {!editable && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Posted</span>}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : (
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap gap-3">
              <label className="text-xs text-muted-foreground">Date
                {editable
                  ? <input type="date" value={date} onChange={e => setDate(e.target.value)} className="mt-0.5 block rounded border border-input bg-transparent px-2 py-1 text-sm" />
                  : <span className="mt-0.5 block px-2 py-1 font-mono text-sm text-foreground">{date || '—'}</span>}
              </label>
              <label className="min-w-[200px] flex-1 text-xs text-muted-foreground">Memo
                {editable
                  ? <input value={memo} onChange={e => setMemo(e.target.value)} className="mt-0.5 block w-full rounded border border-input bg-transparent px-2 py-1 text-sm" />
                  : <span className="mt-0.5 block px-2 py-1 text-sm text-foreground">{memo || '—'}</span>}
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
                  const acct = acctById.get(l.accountId)
                  return (
                    <tr key={l.key}>
                      <td className="py-1 pr-2">
                        {!editable ? (
                          <span className="text-xs">
                            {acct?.name ?? '—'}
                            {acct?.code && <span className="ml-1.5 font-mono text-muted-foreground/70">{acct.code}</span>}
                          </span>
                        ) : (
                          <select
                            value={l.accountId}
                            onChange={e => {
                              const a = acctById.get(e.target.value)
                              // The account determines the partner: per-LP capital accounts carry
                              // their own lp_entity_id, so switching account switches partner.
                              update(l.key, { accountId: e.target.value, lpEntityId: a?.lp_entity_id ?? null })
                            }}
                            className="w-full rounded border border-input bg-transparent px-1.5 py-1 text-xs"
                          >
                            <option value="">Select account…</option>
                            <optgroup label="Accounts">
                              {general.map(a => <option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}
                            </optgroup>
                            {partnerAccounts.length > 0 && (
                              <optgroup label="Partner capital">
                                {partnerAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                              </optgroup>
                            )}
                          </select>
                        )}
                      </td>
                      {editable ? (
                        <>
                          <td className="px-1 py-1"><input inputMode="decimal" value={l.debit} onChange={e => update(l.key, { debit: e.target.value, credit: '' })} className="w-full rounded border border-input bg-transparent px-1.5 py-1 text-right font-mono text-xs" /></td>
                          <td className="px-1 py-1"><input inputMode="decimal" value={l.credit} onChange={e => update(l.key, { credit: e.target.value, debit: '' })} className="w-full rounded border border-input bg-transparent px-1.5 py-1 text-right font-mono text-xs" /></td>
                          <td className="py-1 text-right"><button onClick={() => setLines(prev => prev.filter(x => x.key !== l.key))} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></td>
                        </>
                      ) : (
                        <>
                          <td className="px-1 py-1 text-right font-mono text-xs">{num(l.debit) > 0 ? fmt(num(l.debit)) : ''}</td>
                          <td className="px-1 py-1 text-right font-mono text-xs">{num(l.credit) > 0 ? fmt(num(l.credit)) : ''}</td>
                          <td />
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t text-xs">
                  <td className="pt-1">{editable && <button onClick={() => setLines(prev => [...prev, newLine()])} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><Plus className="h-3.5 w-3.5" /> Add line</button>}</td>
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

            {editable ? (
              <div className="flex justify-end gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
                <Button size="sm" variant="outline" onClick={() => save(false)} disabled={saving || !balanced}>{saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Save draft</Button>
                <Button size="sm" onClick={() => save(true)} disabled={saving || !balanced}>Save &amp; post</Button>
              </div>
            ) : (
              <div className="flex justify-end gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
                <Button size="sm" variant="outline" onClick={unpostAndEdit} disabled={saving} title="Revert to draft so you can edit it">{saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Unpost &amp; edit</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
