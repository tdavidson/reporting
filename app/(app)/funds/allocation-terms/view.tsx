'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, ArrowLeftRight, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'

type Category = 'management_fee' | 'partnership_expense' | 'organizational_expense' | 'realized_gain' | 'valuation' | 'income' | 'carried_interest'

interface Term { lpEntityId: string; category: Category; participates: boolean; weightOverride: number | null; rateOverride: number | null }
interface Partner { lpEntityId: string; name: string; partnerClass: string; commitment: number; terms: Term[] }
interface CommitmentEvent { id: string; lpEntityId: string; name: string; effectiveDate: string; amount: number; kind: string; transferId?: string | null; memo?: string | null }

// The categories worth setting per partner. Gains/income are almost always pro-rata
// to everyone, so they're not surfaced here — the API still accepts them.
const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'management_fee', label: 'Management fee' },
  { key: 'partnership_expense', label: 'Partnership expenses' },
  { key: 'organizational_expense', label: 'Org. expenses' },
  { key: 'carried_interest', label: 'Carried interest' },
]

export function AllocationTermsView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const lf = useLedgerFetch()

  const [basis, setBasis] = useState<'commitment' | 'capital_balance'>('commitment')
  const [partners, setPartners] = useState<Partner[]>([])
  const [events, setEvents] = useState<CommitmentEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [showChange, setShowChange] = useState(false)
  const [isTransfer, setIsTransfer] = useState(false)
  const [lp, setLp] = useState('')
  const [from, setFrom] = useState('')
  const [amount, setAmount] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [memo, setMemo] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [t, c] = await Promise.all([
      lf('/api/accounting/allocation-terms').then(r => (r.ok ? r.json() : null)),
      lf('/api/accounting/commitments').then(r => (r.ok ? r.json() : null)),
    ])
    if (t) { setBasis(t.basis); setPartners(t.partners ?? []) }
    if (c) setEvents(c.events ?? [])
    setLoading(false)
  }, [lf])
  useEffect(() => { load() }, [load])

  const post = async (url: string, body: object, method: 'POST' | 'PATCH' | 'DELETE' = 'POST') => {
    setBusy(true); setError(null)
    try {
      const res = await lf(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      // Guard the parse: a 500 returns an HTML error page, not JSON, so a bare
      // res.json() would throw BEFORE the !res.ok check and the failure would vanish
      // (unhandled rejection, no error shown, busy stuck true).
      const data = await res.json().catch(() => ({} as { error?: string }))
      if (!res.ok) { setError(data.error ?? `Request failed (${res.status})`); return false }
      await load()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request did not complete — check your connection and try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const termFor = (p: Partner, c: Category) => p.terms.find(t => t.category === c)

  async function toggle(p: Partner, c: Category, participates: boolean) {
    await post('/api/accounting/allocation-terms', {
      action: 'term', lpEntityId: p.lpEntityId, category: c, participates,
      weightOverride: termFor(p, c)?.weightOverride ?? null,
    })
  }

  async function submitChange() {
    const amt = Number(amount)
    if (!lp || !effectiveDate || !amt) { setError('Partner, date, and a non-zero amount are required'); return }
    const ok = editingId
      ? await post('/api/accounting/commitments', {
          id: editingId,
          effectiveDate,
          amount: amt,
          memo: memo || null,
        }, 'PATCH')
      : await post('/api/accounting/commitments', {
          lpEntityId: lp,
          effectiveDate,
          amount: amt,
          counterpartyEntityId: isTransfer ? from : null,
          memo: memo || null,
        })
    if (ok) resetChangeForm()
  }

  function resetChangeForm() {
    setLp(''); setFrom(''); setAmount(''); setMemo(''); setEffectiveDate(''); setIsTransfer(false)
    setEditingId(null); setShowChange(false)
  }

  function startEdit(e: CommitmentEvent) {
    setEditingId(e.id)
    setIsTransfer(false)
    setLp(e.lpEntityId)
    setFrom('')
    setAmount(String(e.amount))
    setEffectiveDate(e.effectiveDate)
    setMemo(e.memo ?? '')
    setShowChange(true)
  }

  async function deleteEvent(id: string) {
    if (!window.confirm('Delete this commitment event?')) return
    await post('/api/accounting/commitments', { id }, 'DELETE')
  }

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>

  const totalCommitment = partners.reduce((s, p) => s + p.commitment, 0)

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-amber-600">{error}</p>}

      {/* 1. Basis --------------------------------------------------------- */}
      <div className="border rounded-lg p-4 space-y-2">
        <p className="text-sm font-medium">Allocation basis</p>
        <p className="text-xs text-muted-foreground">
          What the close splits each category on. Commitment is the common default; some LPAs
          allocate on capital-account balance at period end.
        </p>
        <select
          value={basis}
          onChange={e => {
            const v = e.target.value as 'commitment' | 'capital_balance'
            setBasis(v)
            post('/api/accounting/allocation-terms', { action: 'basis', basis: v })
          }}
          disabled={busy}
          className="h-9 px-3 rounded-md border border-input bg-background text-sm"
        >
          <option value="commitment">Committed capital</option>
          <option value="capital_balance">Capital-account balance (at period end)</option>
        </select>
      </div>

      {/* 2. Per-partner terms --------------------------------------------- */}
      <div>
        <p className="text-sm font-medium mb-1">Who bears what</p>
        <p className="text-xs text-muted-foreground mb-2">
          Uncheck to exclude a partner from a category — their share redistributes across everyone
          else, so excluding the GP from the management fee shifts it onto the LPs rather than
          shrinking it.
        </p>
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-3 py-2 font-medium">Partner</th>
                <th className="text-right px-3 py-2 font-medium">Commitment</th>
                {CATEGORIES.map(c => <th key={c.key} className="px-3 py-2 font-medium text-center">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {partners.map(p => (
                <tr key={p.lpEntityId} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-3 py-2">
                    {p.name}
                    {p.partnerClass === 'gp' && <span className="ml-1.5 text-[10px] uppercase tracking-wider px-1 py-0.5 rounded bg-muted text-muted-foreground">GP</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(p.commitment)}</td>
                  {CATEGORIES.map(c => {
                    const t = termFor(p, c.key)
                    const on = t ? t.participates : true
                    return (
                      <td key={c.key} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={busy}
                          onChange={e => toggle(p, c.key, e.target.checked)}
                          aria-label={`${p.name} bears ${c.label}`}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/30 font-semibold">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(totalCommitment)}</td>
                {CATEGORIES.map(c => <td key={c.key} />)}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* 3. Commitment changes -------------------------------------------- */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <p className="text-sm font-medium">Commitment history</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { if (showChange) resetChangeForm(); else setShowChange(true) }}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />Record a change
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">
          Commitments are effective-dated, so closing an old period uses the commitments that were in
          force then. A transfer writes both legs at once — the fund&rsquo;s total can&rsquo;t drift.
        </p>

        {showChange && (
          <div className="border rounded-lg p-3 mb-3 space-y-3">
            {editingId && (
              <p className="text-xs text-muted-foreground">Editing an existing event — partner and transfer type can&rsquo;t change; delete and re-enter to change either.</p>
            )}
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={isTransfer} disabled={!!editingId} onChange={e => setIsTransfer(e.target.checked)} />
              <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
              Transfer between partners (rather than an increase or decrease)
            </label>
            <div className="flex flex-wrap items-end gap-3">
              {isTransfer && (
                <label className="text-xs text-muted-foreground">From
                  <select value={from} disabled={!!editingId} onChange={e => setFrom(e.target.value)} className="mt-1 block h-9 px-2 rounded-md border border-input bg-background text-sm max-w-[200px]">
                    <option value="">Select…</option>
                    {partners.map(p => <option key={p.lpEntityId} value={p.lpEntityId}>{p.name}</option>)}
                  </select>
                </label>
              )}
              <label className="text-xs text-muted-foreground">{isTransfer ? 'To' : 'Partner'}
                <select value={lp} disabled={!!editingId} onChange={e => setLp(e.target.value)} className="mt-1 block h-9 px-2 rounded-md border border-input bg-background text-sm max-w-[200px]">
                  <option value="">Select…</option>
                  {partners.map(p => <option key={p.lpEntityId} value={p.lpEntityId}>{p.name}</option>)}
                </select>
              </label>
              <label className="text-xs text-muted-foreground">Amount
                <Input
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder={isTransfer ? '100000' : '100000 or -50000'}
                  className="mt-1 h-9 w-36 font-mono"
                />
              </label>
              <label className="text-xs text-muted-foreground">Effective
                <Input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} className="mt-1 h-9 w-40" />
              </label>
              <label className="text-xs text-muted-foreground flex-1 min-w-[160px]">Memo
                <Input value={memo} onChange={e => setMemo(e.target.value)} placeholder="Secondary sale" className="mt-1 h-9 w-full" />
              </label>
              <Button size="sm" onClick={submitChange} disabled={busy}>
                {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}{editingId ? 'Save change' : 'Record'}
              </Button>
              {editingId && (
                <Button size="sm" variant="ghost" onClick={resetChangeForm} disabled={busy}>Cancel</Button>
              )}
            </div>
          </div>
        )}

        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No commitment events yet.</p>
        ) : (
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-3 py-2 font-medium">Effective</th>
                  <th className="text-left px-3 py-2 font-medium">Partner</th>
                  <th className="text-left px-3 py-2 font-medium">Kind</th>
                  <th className="text-right px-3 py-2 font-medium">Change</th>
                  <th className="text-right px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map(e => {
                  const isXfer = e.kind.startsWith('transfer')
                  return (
                    <tr key={e.id} className="border-b last:border-b-0">
                      <td className="px-3 py-2 font-mono text-xs">{e.effectiveDate}</td>
                      <td className="px-3 py-2">{e.name}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{e.kind.replace('_', ' ')}</td>
                      <td className={`px-3 py-2 text-right font-mono ${e.amount < 0 ? 'text-muted-foreground' : ''}`}>{fmt(e.amount)}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            disabled={busy || isXfer}
                            title={isXfer ? 'Transfers: delete and re-enter to correct' : 'Edit'}
                            onClick={() => startEdit(e)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            disabled={busy}
                            title="Delete"
                            onClick={() => deleteEvent(e.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
