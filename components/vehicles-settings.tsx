'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Vehicle { id: string; name: string; kind: string; aliases: string[]; active: boolean; serves_vehicle_id?: string | null; lp_entity_id?: string | null; vintage_year?: number | null }
interface LpEntity { id: string; entity_name: string }

const KINDS = ['fund', 'spv', 'direct', 'associate', 'other'] as const
const KIND_LABEL: Record<string, string> = { fund: 'Fund', spv: 'SPV', direct: 'Direct', associate: 'Associate', other: 'Other' }

/** Fund-wide management of investment vehicles (the fund_vehicles registry). */
export function VehiclesSettings() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState('fund')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [entities, setEntities] = useState<LpEntity[]>([])

  function load() {
    setLoading(true)
    fetch('/api/vehicles').then(r => (r.ok ? r.json() : [])).then(d => setVehicles(Array.isArray(d) ? d : [])).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  // The partners an associate could be, on the fund's books.
  useEffect(() => {
    fetch('/api/lps/entities')
      .then(r => (r.ok ? r.json() : []))
      .then(d => setEntities(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

  async function create() {
    const name = newName.trim()
    if (!name) return
    setBusy(true); setError(null)
    const res = await fetch('/api/vehicles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, kind: newKind }) })
    setBusy(false)
    if (res.ok) { setNewName(''); setNewKind('fund'); load() }
    else setError((await res.json().catch(() => ({}))).error ?? 'Could not create vehicle')
  }

  async function patch(id: string, changes: Partial<Vehicle>) {
    setVehicles(prev => prev.map(v => (v.id === id ? { ...v, ...changes } : v))) // optimistic
    await fetch('/api/vehicles', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...changes }) })
  }

  // The row holds snake_case (as the DB returns it) while the API takes camelCase, so this
  // gets its own setter rather than going through `patch`, which passes keys straight through.
  async function setVintage(id: string, vintageYear: number | null) {
    setVehicles(prev => prev.map(v => (v.id === id ? { ...v, vintage_year: vintageYear } : v)))
    await fetch('/api/vehicles', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, vintageYear }) })
  }

  // Link a GP/associate entity to the fund vehicle it serves.
  async function setServes(id: string, servesVehicleId: string | null) {
    setVehicles(prev => prev.map(v => (v.id === id ? { ...v, serves_vehicle_id: servesVehicleId } : v)))
    await fetch('/api/vehicles', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, servesVehicleId }) })
  }

  // …and AS WHOM it holds that position. The look-through needs both halves: which fund the
  // associate invests in, and which partner on that fund's books represents it. With only the
  // first, an associate's members never reach the LP report at all.
  async function setLpEntity(id: string, lpEntityId: string | null) {
    setVehicles(prev => prev.map(v => (v.id === id ? { ...v, lp_entity_id: lpEntityId } : v)))
    await fetch('/api/vehicles', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, lpEntityId }) })
  }

  // Rename cascades the string across all the data server-side, so reload after.
  async function rename(id: string) {
    const name = editName.trim()
    if (!name) return
    setBusy(true); setError(null)
    const res = await fetch('/api/vehicles', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name }) })
    setBusy(false)
    if (res.ok) { setEditingId(null); setEditName(''); load() }
    else setError((await res.json().catch(() => ({}))).error ?? 'Rename failed')
  }

  return (
    <>
      <p className="mb-4 text-xs text-muted-foreground">
        Your fund&apos;s investment vehicles — funds, SPVs, direct deals, and GP/associate entities. This is the single list used across LP snapshots, portfolio grouping, compliance, and accounting. Renaming and merging come with the vehicle-ID migration; for now you can add, re-classify, and deactivate.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
      ) : (
        <div className="divide-y rounded-md border">
          {vehicles.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">No vehicles yet. Add one below.</div>
          ) : vehicles.map(v => (
            <div key={v.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              {editingId === v.id ? (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') rename(v.id); if (e.key === 'Escape') { setEditingId(null); setError(null) } }}
                    className="h-7 max-w-[260px] text-sm" />
                  <button onClick={() => rename(v.id)} disabled={busy || !editName.trim()} className="text-xs text-primary hover:underline disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
                  <button onClick={() => { setEditingId(null); setError(null) }} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                </div>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <span className={v.active ? 'font-medium' : 'text-muted-foreground line-through'}>{v.name}</span>
                    {v.aliases?.length > 0 && <span className="ml-2 text-xs text-muted-foreground">aka {v.aliases.join(', ')}</span>}
                  </div>
                  <select value={v.kind} onChange={e => patch(v.id, { kind: e.target.value })} className="h-7 rounded border border-input bg-transparent px-1.5 text-xs">
                    {KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </select>
                  {/* Vintage year. Nothing derives it, so it has to be stated — unlike carry
                      rate and GP-commit %, which used to sit beside it on fund_group_config and
                      are now obsolete (real waterfall terms; real accrued carry). */}
                  <VintageInput
                    value={v.vintage_year ?? null}
                    onSave={y => setVintage(v.id, y)}
                  />
                  {v.kind === 'associate' && (
                    <>
                      <select value={v.serves_vehicle_id ?? ''} onChange={e => setServes(v.id, e.target.value || null)} title="The fund vehicle this GP/associate entity serves — links their books for the assistant" className="h-7 rounded border border-input bg-transparent px-1.5 text-xs max-w-[160px]">
                        <option value="">GP of… (unset)</option>
                        {vehicles.filter(o => o.kind !== 'associate' && o.id !== v.id).map(o => <option key={o.id} value={o.id}>GP of {o.name}</option>)}
                      </select>
                      {/* The second half of the link. Without it the look-through can't run: we
                          know WHICH fund the associate invests in, but not AS WHOM — and so its
                          members never appear in the LP report at all. */}
                      <select
                        value={v.lp_entity_id ?? ''}
                        onChange={e => setLpEntity(v.id, e.target.value || null)}
                        title="The partner on the fund's books through which this associate holds its position. Required for its members to appear in the LP report."
                        className={`h-7 rounded border px-1.5 text-xs max-w-[170px] bg-transparent ${
                          v.serves_vehicle_id && !v.lp_entity_id ? 'border-amber-500 text-amber-600' : 'border-input'
                        }`}
                      >
                        <option value="">invests as… (unset)</option>
                        {entities.map(e => <option key={e.id} value={e.id}>invests as {e.entity_name}</option>)}
                      </select>
                    </>
                  )}
                  <button onClick={() => { setEditingId(v.id); setEditName(v.name) }} className="text-xs text-muted-foreground hover:text-foreground">Rename</button>
                  <button onClick={() => patch(v.id, { active: !v.active })} className="w-20 text-right text-xs text-muted-foreground hover:text-foreground">
                    {v.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') create() }} placeholder="New vehicle name (e.g. Fund IV, LP)" className="h-8 max-w-[260px] text-sm" />
        <select value={newKind} onChange={e => setNewKind(e.target.value)} className="h-8 rounded border border-input bg-background px-2 text-sm">
          {KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <Button size="sm" onClick={create} disabled={busy || !newName.trim()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}Add vehicle
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </>
  )
}

/** Vintage year — saves on blur, clears when emptied. */
function VintageInput({ value, onSave }: { value: number | null; onSave: (y: number | null) => void }) {
  const [draft, setDraft] = useState(value == null ? '' : String(value))
  useEffect(() => { setDraft(value == null ? '' : String(value)) }, [value])

  return (
    <Input
      value={draft}
      onChange={e => setDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
      onBlur={() => {
        const next = draft === '' ? null : Number(draft)
        if (next !== value) onSave(next)
      }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      placeholder="Vintage"
      title="Vintage year"
      inputMode="numeric"
      className="h-7 w-[72px] text-xs"
    />
  )
}
