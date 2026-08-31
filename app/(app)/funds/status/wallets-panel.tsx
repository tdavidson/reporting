'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { Loader2, Trash2, Plus, AlertTriangle, Check, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useLedgerFetch } from '@/components/accounting-vehicle'

/**
 * Watched wallets — the addresses a digital-asset holding sits in.
 *
 * The variance is the headline, not the balance. A balance on its own tells you what you already
 * put in the books; the gap between the chain and the books is the only thing here that can tell
 * you something you did not know.
 */

interface Balance { as_of_date: string; units: number; block_height: number | null; source: string }

interface WalletRow {
  id: string
  company_id: string
  chain: string
  address: string
  label: string | null
  active: boolean
  verified_at: string | null
  verification_method: string | null
  latestBalance: Balance | null
  holdingName: string | null
}

interface Variance {
  companyId: string
  name: string
  observedUnits: number
  recordedUnits: number
  delta: number
  asOf: string | null
}

interface Holding { companyId: string; name: string }

const EMPTY = { companyId: '', chain: 'ethereum', address: '', label: '' }

const CHAINS = ['ethereum', 'bitcoin', 'solana', 'base', 'arbitrum', 'polygon', 'avalanche']

const units = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 8 })

function shortAddress(a: string) {
  return a.length <= 14 ? a : `${a.slice(0, 8)}…${a.slice(-4)}`
}

export function WalletsPanel({ onChanged }: { onChanged?: () => void }) {
  const lf = useLedgerFetch()
  const [wallets, setWallets] = useState<WalletRow[]>([])
  const [variances, setVariances] = useState<Variance[]>([])
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [balanceFor, setBalanceFor] = useState<string | null>(null)
  const [balanceForm, setBalanceForm] = useState({ asOfDate: '', units: '', blockHeight: '' })

  const load = useCallback(async () => {
    setLoading(true)
    const [walletRes, posRes] = await Promise.all([
      lf('/api/accounting/crypto-wallets'),
      lf('/api/accounting/investments'),
    ])
    const walletData = walletRes.ok ? await walletRes.json() : null
    const posData = posRes.ok ? await posRes.json() : null
    setWallets(walletData?.wallets ?? [])
    setVariances(walletData?.variances ?? [])
    setHoldings((posData?.positions ?? []).map((p: any) => ({ companyId: p.companyId, name: p.name })))
    setLoading(false)
  }, [lf])
  useEffect(() => { load() }, [load])

  const post = async (body: object) => {
    setBusy(true); setError(null); setNote(null)
    const res = await lf('/api/accounting/crypto-wallets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(data.error ?? 'Failed'); return null }
    await load(); onChanged?.()
    return data
  }

  async function addWallet() {
    const d = await post({
      companyId: form.companyId,
      chain: form.chain,
      address: form.address.trim(),
      label: form.label.trim() || null,
    })
    if (d) {
      setAdding(false); setForm({ ...EMPTY })
      setNote('Now watching that address.')
      if (d.warning) setError(d.warning)
    }
  }

  async function removeWallet(id: string, address: string) {
    setBusy(true); setError(null); setNote(null)
    const res = await lf(`/api/accounting/crypto-wallets?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) { setError('Could not stop watching that address.'); return }
    setNote(`No longer watching ${shortAddress(address)}.`)
    await load(); onChanged?.()
  }

  async function recordBalance(walletId: string) {
    const d = await post({
      action: 'record-balance',
      walletId,
      asOfDate: balanceForm.asOfDate,
      units: parseFloat(balanceForm.units),
      blockHeight: balanceForm.blockHeight ? parseInt(balanceForm.blockHeight, 10) : null,
    })
    if (d) { setBalanceFor(null); setBalanceForm({ asOfDate: '', units: '', blockHeight: '' }) }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />Loading wallets…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-medium">Watched wallets</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Public addresses a digital-asset holding sits in. Reading one gives a second, independent
            answer to how much the fund holds — the only asset class here where somebody outside the
            fund can check a position for themselves.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding(a => !a)} disabled={busy}>
          <Plus className="h-3.5 w-3.5 mr-1" />Watch an address
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

      {/* The variance is the reason any of this exists, so it sits above the addresses. */}
      {variances.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning-subtle px-3 py-2 space-y-1">
          <p className="text-sm font-medium">The chain and the books disagree</p>
          {variances.map(v => (
            <p key={v.companyId} className="text-xs tabular-nums">
              {v.name}: chain shows {units(v.observedUnits)} at {v.asOf}, books record{' '}
              {units(v.recordedUnits)} —{' '}
              <span className="font-medium">
                {units(Math.abs(v.delta))} {v.delta > 0 ? 'unrecorded on-chain' : 'missing on-chain'}
              </span>.
            </p>
          ))}
          <p className="text-xs text-muted-foreground pt-1">
            Often a transfer between your own wallets, an airdrop nobody has triaged, or staking
            rewards still accruing. The close reports this but does not block on it — the books may
            well be the right number.
          </p>
        </div>
      )}

      {adding && (
        <div className="rounded-lg border p-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
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
              <Label className="text-xs">Chain</Label>
              <Select value={form.chain} onValueChange={v => setForm(f => ({ ...f, chain: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CHAINS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">Address</Label>
              <Input className="mt-1 font-mono text-xs" value={form.address} placeholder="0x…"
                onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">Label</Label>
              <Input className="mt-1" value={form.label} placeholder="Treasury, cold storage…"
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            A public, watch-only address — never a key or a seed phrase. Nothing here can move funds,
            and the address is stored in the clear precisely so the position can be checked.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={addWallet} disabled={busy || !form.companyId || !form.address}>
              Watch it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setForm({ ...EMPTY }) }}>Cancel</Button>
          </div>
        </div>
      )}

      {wallets.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No addresses watched. A digital asset can be tracked by hand like any other holding —
          watching an address just adds a second opinion on the quantity.
        </p>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-3 py-2 font-medium">Address</th>
                <th className="text-left px-3 py-2 font-medium">Holding</th>
                <th className="text-right px-3 py-2 font-medium">Last read</th>
                <th className="text-left px-3 py-2 font-medium">On</th>
                <th className="text-left px-3 py-2 font-medium">Control</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {wallets.map(w => (
                <Fragment key={w.id}>
                  <tr className="border-b last:border-b-0">
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs">{shortAddress(w.address)}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{w.label ?? w.chain}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{w.holdingName ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {w.latestBalance ? units(w.latestBalance.units) : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                      {w.latestBalance?.as_of_date ?? 'never read'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {w.verified_at ? (
                        <span className="inline-flex items-center gap-1 text-success">
                          <ShieldCheck className="h-3.5 w-3.5" />proven
                        </span>
                      ) : (
                        <Select
                          value=""
                          onValueChange={v => post({ action: 'verify', walletId: w.id, method: v })}
                        >
                          <SelectTrigger className="h-7 w-36 text-xs"><SelectValue placeholder="Unproven" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="signed_message">Signed message</SelectItem>
                            <SelectItem value="test_transaction">Test transaction</SelectItem>
                            <SelectItem value="custodian_statement">Custodian statement</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" className="text-xs h-7"
                        onClick={() => setBalanceFor(balanceFor === w.id ? null : w.id)}>
                        Record a balance
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7" disabled={busy}
                        onClick={() => removeWallet(w.id, w.address)} aria-label={`Stop watching ${w.address}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                  {balanceFor === w.id && (
                    <tr className="border-b bg-muted/20">
                      <td colSpan={6} className="px-3 py-3">
                        <div className="flex flex-wrap items-end gap-3">
                          <div>
                            <Label className="text-xs">As of</Label>
                            <Input className="mt-1 w-40" type="date" value={balanceForm.asOfDate}
                              onChange={e => setBalanceForm(b => ({ ...b, asOfDate: e.target.value }))} />
                          </div>
                          <div>
                            <Label className="text-xs">Units</Label>
                            <Input className="mt-1 w-40" type="number" step="any" value={balanceForm.units}
                              onChange={e => setBalanceForm(b => ({ ...b, units: e.target.value }))} />
                          </div>
                          <div>
                            <Label className="text-xs">Block height</Label>
                            <Input className="mt-1 w-40" type="number" value={balanceForm.blockHeight}
                              placeholder="optional"
                              onChange={e => setBalanceForm(b => ({ ...b, blockHeight: e.target.value }))} />
                          </div>
                          <Button size="sm" disabled={busy || !balanceForm.asOfDate || !balanceForm.units}
                            onClick={() => recordBalance(w.id)}>Save reading</Button>
                        </div>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          The block height is what makes a reading reproducible — with it, anyone can
                          re-derive the same number from the chain a year later. Re-entering a date
                          replaces that day&rsquo;s reading rather than adding a second one.
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

      <div className="rounded-lg border p-3">
        <p className="text-sm font-medium">Where the balances come from</p>
        <p className="text-xs text-muted-foreground mt-1">
          Balances are read and entered by hand today. Connecting a chain API later changes nothing
          you can see here — a reading is stored, sourced and reconciled the same way whether a
          person typed it or a node reported it.
        </p>
        <p className="text-[11px] text-muted-foreground mt-2">
          A watched address proves a <em>balance</em>, not ownership — anyone can watch any address.
          Recording how control was demonstrated is what turns it into evidence an auditor will accept.
        </p>
      </div>
    </div>
  )
}
