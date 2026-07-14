'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLedgerFetch } from '@/components/accounting-vehicle'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'

// The GP / associate entity panel: who owns the vehicle, who holds carry points, and how
// much carry each partner has accrued, been paid, and is still owed.
//
// Renders only for a vehicle that IS a GP/associate entity linked to a fund — the API
// returns { gp: null } otherwise and this collapses to nothing. It replaces the "GP Entity
// Ownership" table that lived on the LPs page, which matched entities by free-text name and
// netted carry off NAV.

interface Partner {
  lpEntityId: string
  name: string
  ownershipPct: number
  carryPct: number
  ownershipWeight: number
  carryWeight: number | null
  capital: { ending: number; carriedInterest: number }
  carryAccrued: number
  carryPaid: number
  carryUnpaid: number
}
interface Gp {
  link: { vehicle: string; servesVehicle: string }
  basis: 'commitments' | 'override' | 'none'
  associate: { ending: number; carriedInterest: number }
  partners: Partner[]
  totals: { carryAccrued: number; carryPaid: number; carryUnpaid: number; ending: number }
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`

export function GpPanel({ isAdmin }: { isAdmin: boolean }) {
  const lf = useLedgerFetch()
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)

  const [gp, setGp] = useState<Gp | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [payFor, setPayFor] = useState<string | null>(null)
  const [payDate, setPayDate] = useState('')
  const [payAmount, setPayAmount] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    lf('/api/accounting/gp-economics')
      .then(r => (r.ok ? r.json() : { gp: null }))
      .then(d => setGp(d.gp ?? null))
      .finally(() => setLoading(false))
  }, [lf])
  useEffect(() => { load() }, [load])

  async function saveWeight(lpEntityId: string, field: 'ownershipWeight' | 'carryWeight', raw: string) {
    setSaving(lpEntityId + field)
    setError(null)
    const value = raw.trim() === '' ? null : Number(raw)
    const res = await lf('/api/accounting/gp-economics', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lpEntityId, [field]: value }),
    })
    const d = await res.json()
    setSaving(null)
    if (!res.ok) { setError(d.error ?? 'Could not save'); return }
    setGp(d.gp)
  }

  async function addPayment(lpEntityId: string) {
    setSaving(lpEntityId + 'pay')
    setError(null)
    const res = await lf('/api/accounting/gp-economics', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lpEntityId, paidDate: payDate, amount: Number(payAmount) }),
    })
    const d = await res.json()
    setSaving(null)
    if (!res.ok) { setError(d.error ?? 'Could not record the payment'); return }
    setGp(d.gp)
    setPayFor(null); setPayDate(''); setPayAmount('')
  }

  if (loading || !gp) return null

  const derived = gp.basis === 'commitments'

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">
          {gp.link.vehicle} — partner economics
          <span className="ml-2 text-xs font-normal text-muted-foreground">GP of {gp.link.servesVehicle}</span>
        </h2>
        <p className="text-xs text-muted-foreground max-w-3xl">
          Ownership splits the capital this entity holds in {gp.link.servesVehicle} and everything that follows
          capital. <strong>Carry points are separate</strong> and split only the carried interest it earns — they
          routinely diverge from committed capital, and a partner can hold carry while committing nothing.
        </p>
      </div>

      {/* Where ownership comes from. A derived number can't drift from the books, so say when
          it's derived and make it read-only. */}
      <p className="text-xs text-muted-foreground">
        {derived ? (
          <>Ownership is <strong>derived from commitments</strong> on {gp.link.vehicle}, so it is read-only here. Change a
          commitment to change the split.</>
        ) : gp.basis === 'override' ? (
          <>Ownership is <strong>set by hand</strong> — this vehicle has no commitments to derive from. Weights are
          normalized, so 20/80 and 2/8 mean the same thing.</>
        ) : (
          <>This vehicle has <strong>no commitments and no ownership set</strong>. Enter weights below, or record
          commitments on it.</>
        )}
      </p>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-1.5 font-medium">Partner</th>
              <th className="text-right px-3 py-1.5 font-medium">Ownership</th>
              <th className="text-right px-3 py-1.5 font-medium">Carry points</th>
              <th className="text-right px-3 py-1.5 font-medium">Capital</th>
              <th className="text-right px-3 py-1.5 font-medium">Carry accrued</th>
              <th className="text-right px-3 py-1.5 font-medium">Carry paid</th>
              <th className="text-right px-3 py-1.5 font-medium">Accrued, unpaid</th>
              {isAdmin && <th className="px-3 py-1.5" />}
            </tr>
          </thead>
          <tbody>
            {gp.partners.map(p => (
              <tr key={p.lpEntityId} className="border-t">
                <td className="px-3 py-1.5">{p.name}</td>

                <td className="px-3 py-1.5 text-right font-mono">
                  {derived || !isAdmin ? (
                    pct(p.ownershipPct)
                  ) : (
                    <WeightInput
                      value={p.ownershipWeight || ''}
                      suffix={pct(p.ownershipPct)}
                      busy={saving === p.lpEntityId + 'ownershipWeight'}
                      onSave={v => saveWeight(p.lpEntityId, 'ownershipWeight', v)}
                    />
                  )}
                </td>

                <td className="px-3 py-1.5 text-right font-mono">
                  {isAdmin ? (
                    <WeightInput
                      value={p.carryWeight ?? ''}
                      suffix={pct(p.carryPct)}
                      busy={saving === p.lpEntityId + 'carryWeight'}
                      onSave={v => saveWeight(p.lpEntityId, 'carryWeight', v)}
                      placeholder="—"
                    />
                  ) : pct(p.carryPct)}
                </td>

                <td className="px-3 py-1.5 text-right font-mono">{fmt(p.capital.ending)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{fmt(p.carryAccrued)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{fmt(p.carryPaid)}</td>
                <td className="px-3 py-1.5 text-right font-mono font-medium">{fmt(p.carryUnpaid)}</td>

                {isAdmin && (
                  <td className="px-3 py-1.5 text-right">
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => { setPayFor(payFor === p.lpEntityId ? null : p.lpEntityId); setPayAmount(''); setPayDate('') }}
                    >
                      <Plus className="h-3.5 w-3.5 inline" /> carry paid
                    </button>
                  </td>
                )}
              </tr>
            ))}

            <tr className="border-t font-medium">
              <td className="px-3 py-1.5">Total</td>
              <td /><td />
              <td className="px-3 py-1.5 text-right font-mono">{fmt(gp.totals.ending)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{fmt(gp.totals.carryAccrued)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{fmt(gp.totals.carryPaid)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{fmt(gp.totals.carryUnpaid)}</td>
              {isAdmin && <td />}
            </tr>
          </tbody>
        </table>
      </div>

      {payFor && (
        <div className="border rounded-lg p-3 flex flex-wrap items-end gap-3">
          <p className="text-xs text-muted-foreground w-full">
            Record carry paid to <strong>{gp.partners.find(p => p.lpEntityId === payFor)?.name}</strong>.
          </p>
          <label className="text-xs text-muted-foreground">Date
            <Input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className="mt-1 h-9 w-40" />
          </label>
          <label className="text-xs text-muted-foreground">Amount
            <Input value={payAmount} onChange={e => setPayAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="mt-1 h-9 w-36 font-mono" />
          </label>
          <Button size="sm" onClick={() => addPayment(payFor)} disabled={!payDate || !payAmount || saving !== null}>
            {saving === payFor + 'pay' && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Record
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPayFor(null)}>Cancel</Button>
        </div>
      )}

      {/* The sentence that stops a GP thinking they're owed money they aren't. */}
      <p className="text-xs text-muted-foreground max-w-3xl">
        Accrued carry is a <strong>mark, not a debt</strong>. The close recomputes it from NAV each period and posts
        only the change, so it reverses on its own if NAV falls. &ldquo;Accrued, unpaid&rdquo; is what this partner would
        be owed if {gp.link.servesVehicle} liquidated at today&rsquo;s NAV — it is not a receivable.
      </p>
    </div>
  )
}

/** A weight cell that saves on blur and shows the resulting % beside it. */
function WeightInput({
  value, suffix, busy, onSave, placeholder,
}: {
  value: number | string
  suffix: string
  busy: boolean
  onSave: (v: string) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState(String(value ?? ''))
  useEffect(() => { setDraft(String(value ?? '')) }, [value])

  return (
    <span className="inline-flex items-center gap-1.5 justify-end">
      <Input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { if (draft !== String(value ?? '')) onSave(draft) }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        inputMode="decimal"
        placeholder={placeholder}
        className="h-8 w-20 text-right font-mono"
      />
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="text-xs text-muted-foreground w-14">{suffix}</span>}
    </span>
  )
}
