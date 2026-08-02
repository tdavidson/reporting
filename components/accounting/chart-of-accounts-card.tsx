'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Eye, EyeOff, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLedgerFetch } from '@/components/accounting-vehicle'

interface Acct {
  id: string
  code: string
  name: string
  type: string
  subtype: string | null
  lp_entity_id: string | null
  is_active: boolean
}

const TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const
const TYPE_LABEL: Record<string, string> = {
  asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses',
}

/**
 * Add, rename and hide accounts on this vehicle's chart.
 *
 * Three verbs, deliberately — no delete. `journal_postings.account_id` is `on delete restrict`,
 * so an account with any history cannot be deleted anyway, and one without history is harmless
 * to leave hidden. Hiding is the honest version of what people actually want: stop offering it.
 *
 * Per-partner capital accounts (`3100-<partner>`) are NOT listed. They're derived from the
 * partners themselves — renaming one would drift from the partner's name, and hiding one would
 * remove that partner from the entry modal, which is how a posting gets attributed to them.
 */
export function ChartOfAccountsCard() {
  const lf = useLedgerFetch()
  const [accounts, setAccounts] = useState<Acct[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<string>('expense')

  const load = useCallback(() => {
    setLoading(true)
    lf('/api/accounting/chart')
      .then(r => (r.ok ? r.json() : []))
      .then(d => setAccounts(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false))
  }, [lf])
  useEffect(() => { load() }, [load])

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id); setErr(null)
    const res = await lf('/api/accounting/chart', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }),
    })
    setBusy(null)
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? 'Could not update the account'); return }
    setEditingId(null)
    load()
  }

  async function add() {
    setBusy('add'); setErr(null)
    const res = await lf('/api/accounting/chart', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', code: code.trim(), name: name.trim(), type }),
    })
    setBusy(null)
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? 'Could not add the account'); return }
    setCode(''); setName(''); setShowAdd(false)
    load()
  }

  // Partner capital accounts are managed with the partner, not here.
  const listed = accounts.filter(a => !a.lp_entity_id)

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setShowAdd(v => !v)}>
          <Plus className="h-4 w-4 mr-1" />Add account
        </Button>
        <span className="text-xs text-muted-foreground">
          Hidden accounts keep every posting and stay in the statements — they just stop being offered for new entries.
        </span>
        {err && <span className="text-sm text-warning">{err}</span>}
      </div>

      {showAdd && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3">
          <label className="text-xs text-muted-foreground">Code
            <Input value={code} onChange={e => setCode(e.target.value)} placeholder="5400" className="mt-1 h-8 w-28 tabular-nums" />
          </label>
          <label className="text-xs text-muted-foreground flex-1 min-w-[180px]">Name
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Audit fees" className="mt-1 h-8 w-full" />
          </label>
          <label className="text-xs text-muted-foreground">Type
            <select value={type} onChange={e => setType(e.target.value)} className="mt-1 block h-8 rounded-md border border-input bg-background px-2 text-sm">
              {TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </label>
          <Button size="sm" onClick={add} disabled={busy === 'add' || !code.trim() || !name.trim()}>
            {busy === 'add' && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setShowAdd(false); setErr(null) }}>Cancel</Button>
        </div>
      )}

      <div className="space-y-3">
        {TYPES.filter(t => listed.some(a => a.type === t)).map(t => (
          <div key={t}>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{TYPE_LABEL[t]}</p>
            <div className="divide-y rounded-lg border">
              {listed.filter(a => a.type === t).map(a => (
                <div key={a.id} className={`flex items-center gap-3 px-3 py-2 text-sm ${a.is_active ? '' : 'bg-muted/30'}`}>
                  <span className="w-16 shrink-0 tabular-nums text-muted-foreground">{a.code}</span>
                  {editingId === a.id ? (
                    <>
                      <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-8 flex-1"
                        onKeyDown={e => { if (e.key === 'Enter' && editName.trim()) patch(a.id, { name: editName.trim() }) }} />
                      <button onClick={() => editName.trim() && patch(a.id, { name: editName.trim() })} title="Save" className="text-muted-foreground hover:text-foreground">
                        <Check className="h-4 w-4" />
                      </button>
                      <button onClick={() => setEditingId(null)} title="Cancel" className="text-muted-foreground hover:text-foreground">
                        <X className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => { setEditingId(a.id); setEditName(a.name) }}
                        title="Rename — the code can't change, because the rest of the system finds this account by it"
                        className={`flex-1 truncate text-left hover:underline ${a.is_active ? '' : 'text-muted-foreground line-through'}`}
                      >
                        {a.name}
                      </button>
                      {!a.is_active && <span className="shrink-0 text-xs text-muted-foreground">Hidden</span>}
                      <button
                        onClick={() => patch(a.id, { isActive: !a.is_active })}
                        disabled={busy === a.id}
                        title={a.is_active ? 'Hide — stops it being offered for new entries' : 'Show again'}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                      >
                        {busy === a.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : a.is_active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
