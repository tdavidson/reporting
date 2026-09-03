'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus, ArrowUpRight, ArrowDownLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useCurrency, formatCurrencyFull } from '@/components/currency-context'

// Intercompany: what the funds owe the management company and what it owes them.
//
// Two things on one card, deliberately. The BALANCES are the answer ("Fund II owes us $312,500"),
// read straight off the ledger. The REGISTER underneath is how each balance got there, and it is
// the only place a charge can be settled. Splitting them across two pages would mean answering the
// question in one place and acting on it in another.

interface Balance {
  counterpartyVehicleId: string; counterpartyName: string
  dueFrom: number; dueTo: number; net: number
}
interface Charge {
  id: string; kind: string; chargeDate: string; amount: number; memo: string | null
  status: 'accrued' | 'settled' | 'void'; settledDate: string | null
  direction: 'receivable' | 'payable'; counterpartyVehicleId: string
}
interface Counterparty { id: string | null; name: string }

const KIND_LABELS: Record<string, string> = {
  management_fee: 'Management fee',
  expense_reimbursement: 'Expense reimbursement',
  allocated_cost: 'Allocated cost',
  loan_advance: 'Advance',
  loan_repayment: 'Advance repaid',
  other: 'Other charge',
}

/** Kinds that create a balance now and move cash later. Mirrors ACCRUING_KINDS server-side. */
const ACCRUING = new Set(['management_fee', 'expense_reimbursement', 'allocated_cost', 'other'])

const today = () => new Date().toISOString().slice(0, 10)

export function IntercompanyPanel({
  vehicle, vehicleId, balances, charges, onChanged,
}: {
  vehicle: string
  vehicleId: string
  balances: Balance[]
  charges: Charge[]
  onChanged: () => void
}) {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyFull(v, currency)

  const [open, setOpen] = useState(false)
  const [settling, setSettling] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const nameFor = (id: string) =>
    balances.find(b => b.counterpartyVehicleId === id)?.counterpartyName ?? 'Another vehicle'

  async function settle(charge: Charge) {
    setSettling(charge.id); setError(null)
    const res = await fetch('/api/manco/intercompany', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: vehicle, action: 'settle', id: charge.id, settledDate: today() }),
    })
    setSettling(null)
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? 'Could not settle that charge')
      return
    }
    onChanged()
  }

  return (
    <Card>
      <CardContent className="pt-4 pb-4 px-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="text-sm font-medium">Intercompany</p>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />Record a charge
          </Button>
        </div>

        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

        {balances.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No intercompany balances. Recording a charge posts both sides &mdash; the receivable
            and the income here, the expense and the payable on the other vehicle&rsquo;s books.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-caption uppercase text-muted-foreground">
                  <th className="py-1.5 pr-3 font-normal">Counterparty</th>
                  {/* Due from and due to are shown SEPARATELY and only then netted. A counterparty
                      confirms a payable and a receivable, not a net — see intercompany.ts. */}
                  <th className="py-1.5 px-3 text-right font-normal">Owes us</th>
                  <th className="py-1.5 px-3 text-right font-normal">We owe</th>
                  <th className="py-1.5 pl-3 text-right font-normal">Net</th>
                </tr>
              </thead>
              <tbody>
                {balances.map(b => (
                  <tr key={b.counterpartyVehicleId || b.counterpartyName} className="border-b last:border-0">
                    <td className="py-2 pr-3">{b.counterpartyName}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{fmt(b.dueFrom)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{fmt(b.dueTo)}</td>
                    <td className="py-2 pl-3 text-right tabular-nums font-medium">{fmt(b.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {charges.length > 0 && (
          <div className="mt-4">
            <p className="text-caption uppercase text-muted-foreground mb-2">Charges</p>
            <div className="divide-y">
              {charges.slice(0, 12).map(c => (
                <div key={c.id} className="flex items-center gap-3 py-2">
                  {c.direction === 'receivable'
                    ? <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-success" />
                    : <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {KIND_LABELS[c.kind] ?? c.kind}
                      <span className="text-muted-foreground">
                        {' '}&middot; {c.direction === 'receivable' ? 'billed to' : 'billed by'}{' '}
                        {nameFor(c.counterpartyVehicleId)}
                      </span>
                    </p>
                    <p className="text-caption text-muted-foreground">
                      {c.chargeDate}
                      {c.memo ? ` · ${c.memo}` : ''}
                      {c.status === 'settled' && c.settledDate ? ` · settled ${c.settledDate}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-sm tabular-nums">{fmt(c.amount)}</div>
                  <div className="w-24 shrink-0 text-right">
                    {c.status === 'accrued' && ACCRUING.has(c.kind) ? (
                      <Button
                        size="sm" variant="outline"
                        onClick={() => settle(c)} disabled={settling === c.id}
                      >
                        {settling === c.id && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                        Settle
                      </Button>
                    ) : (
                      <span className="text-caption text-muted-foreground">
                        {c.status === 'settled' ? 'Settled' : c.status === 'void' ? 'Void' : 'Outstanding'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <ChargeDialog
          open={open}
          onOpenChange={setOpen}
          vehicle={vehicle}
          vehicleId={vehicleId}
          onPosted={() => { setOpen(false); onChanged() }}
        />
      </CardContent>
    </Card>
  )
}

/**
 * Record a charge.
 *
 * DIRECTION IS A CHOICE, not something inferred from which vehicle you picked. An intercompany
 * charge entered backwards balances perfectly on both ledgers and is invisible until someone
 * reconciles months later, so the form asks in words — "we billed them" / "they billed us" — rather
 * than making the user reason about payer and payee.
 */
function ChargeDialog({
  open, onOpenChange, vehicle, vehicleId, onPosted,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  vehicle: string
  vehicleId: string
  onPosted: () => void
}) {
  const [counterparties, setCounterparties] = useState<Counterparty[]>([])
  const [counterpartyId, setCounterpartyId] = useState('')
  const [kind, setKind] = useState('management_fee')
  const [direction, setDirection] = useState<'receivable' | 'payable'>('receivable')
  const [chargeDate, setChargeDate] = useState(today())
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    fetch(`/api/manco/intercompany?group=${encodeURIComponent(vehicle)}`)
      .then(r => (r.ok ? r.json() : { counterparties: [] }))
      .then(d => {
        const list: Counterparty[] = (d.counterparties ?? []).filter((c: Counterparty) => c.id)
        setCounterparties(list)
        setCounterpartyId(prev => prev || (list[0]?.id ?? ''))
      })
      .catch(() => setCounterparties([]))
  }, [open, vehicle, vehicleId])

  async function post() {
    setBusy(true); setErr(null)
    const res = await fetch('/api/manco/intercompany', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group: vehicle, action: 'charge', kind, direction, chargeDate,
        amount: Number(amount), counterpartyVehicleId: counterpartyId,
        memo: memo.trim() || undefined,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      setErr((await res.json().catch(() => ({}))).error ?? 'Could not record the charge')
      return
    }
    setAmount(''); setMemo('')
    onPosted()
  }

  const valid = counterpartyId && Number(amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(chargeDate)

  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) setErr(null) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record an intercompany charge</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Direction</label>
            <div className="inline-flex rounded-md border p-0.5 text-xs">
              {([
                ['receivable', 'We billed them'],
                ['payable', 'They billed us'],
              ] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setDirection(v)}
                  className={`px-2.5 py-1 rounded ${direction === v ? 'bg-muted font-medium' : 'text-muted-foreground'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Counterparty</label>
            <select
              value={counterpartyId}
              onChange={e => setCounterpartyId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              {counterparties.length === 0 && <option value="">No other vehicles in this fund</option>}
              {counterparties.map(c => <option key={c.id!} value={c.id!}>{c.name}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Type</label>
            <select
              value={kind}
              onChange={e => setKind(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              {Object.entries(KIND_LABELS).map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
            <p className="text-caption text-muted-foreground">
              {ACCRUING.has(kind)
                ? 'Books income and a receivable here, expense and a payable there. Cash moves when you settle it.'
                : 'Moves cash on both sides now, and leaves the balance outstanding until it is repaid.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Date</label>
              <Input type="date" value={chargeDate} onChange={e => setChargeDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Amount</label>
              <Input
                type="number" min="0" step="0.01" inputMode="decimal"
                value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Memo (optional)</label>
            <Input value={memo} onChange={e => setMemo(e.target.value)} placeholder="e.g. Q1 2026 management fee" />
          </div>

          {err && <p className="text-sm text-destructive">{err}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={post} disabled={busy || !valid}>
              {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Post both sides
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
