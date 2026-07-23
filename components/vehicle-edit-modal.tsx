'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const KINDS = [
  { value: 'fund', label: 'Fund' },
  { value: 'spv', label: 'SPV' },
  { value: 'direct', label: 'Direct deal' },
  { value: 'associate', label: 'GP / associate entity' },
  { value: 'other', label: 'Other' },
]

export interface EditableVehicle {
  id: string
  name: string
  kind: string
  vintage_year: number | null
  active: boolean
  aliases: string[]
}

/** Edit a single investment vehicle in place (name, type, vintage, active). Renaming cascades the
 *  string across all data server-side and keeps the old name as an alias. GP/carry links live on the
 *  fund pages, not here. */
export function VehicleEditModal({ vehicle, onClose, onSaved }: {
  vehicle: EditableVehicle
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(vehicle.name)
  const [kind, setKind] = useState(vehicle.kind || 'fund')
  const [vintage, setVintage] = useState(vehicle.vintage_year != null ? String(vehicle.vintage_year) : '')
  const [active, setActive] = useState(vehicle.active)
  const [aliases, setAliases] = useState<string[]>(vehicle.aliases ?? [])
  const [aliasInput, setAliasInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Merge into another vehicle — collapses a duplicate (e.g. a backfilled "Ocrolus SPV" row) into
  // an existing one, moving its data and deleting this row. Fetched lazily from the same list the
  // management page uses, minus this vehicle.
  const [others, setOthers] = useState<LinkableVehicle[] | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState('')
  const [mergeConfirming, setMergeConfirming] = useState(false)
  const [mergeBusy, setMergeBusy] = useState(false)
  const [mergeErr, setMergeErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/vehicles').then(r => r.ok ? r.json() : []).then(data => {
      if (cancelled) return
      const list: any[] = Array.isArray(data) ? data : (data?.vehicles ?? [])
      setOthers(list.filter(v => v.id !== vehicle.id))
    }).catch(() => { if (!cancelled) setOthers([]) })
    return () => { cancelled = true }
  }, [vehicle.id])

  function addAlias() {
    const a = aliasInput.trim()
    if (a && !aliases.includes(a)) setAliases(prev => [...prev, a])
    setAliasInput('')
  }

  async function doMerge() {
    if (!mergeTargetId) return
    setMergeBusy(true); setMergeErr(null)
    const res = await fetch('/api/vehicles', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: vehicle.id, mergeIntoId: mergeTargetId }),
    })
    setMergeBusy(false)
    if (!res.ok) { setMergeErr((await res.json().catch(() => ({}))).error ?? 'Could not merge vehicle'); return }
    onSaved()
  }

  async function save() {
    setBusy(true); setErr(null)
    const res = await fetch('/api/vehicles', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: vehicle.id,
        name: name.trim(),
        kind,
        vintageYear: vintage.trim() === '' ? null : Number(vintage),
        active,
        aliases,
      }),
    })
    setBusy(false)
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? 'Could not save vehicle'); return }
    onSaved()
  }

  const renamed = name.trim() !== vehicle.name

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit vehicle</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Name</label>
            <Input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save() }} />
            {renamed && <p className="text-[11px] text-muted-foreground">Renaming updates it everywhere; the old name is kept as an alias.</p>}
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Type</label>
            <select value={kind} onChange={e => setKind(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
              {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Vintage year</label>
            <Input value={vintage} onChange={e => setVintage(e.target.value)} inputMode="numeric" placeholder="e.g. 2021" className="w-32" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Also known as (aliases)</label>
            <p className="text-[11px] text-muted-foreground">Other names/portfolio-group strings that map to this vehicle (e.g. from imports).</p>
            {aliases.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {aliases.map(a => (
                  <span key={a} className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5 text-xs">
                    {a}
                    <button onClick={() => setAliases(prev => prev.filter(x => x !== a))} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input value={aliasInput} onChange={e => setAliasInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAlias() } }} placeholder="Add an alias" className="h-8" />
              <Button variant="outline" size="sm" onClick={addAlias} disabled={!aliasInput.trim()}>Add</Button>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="h-3.5 w-3.5" />
            Active
          </label>
          {err && <p className="text-xs text-destructive">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={busy || !name.trim()}>{busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Save</Button>
          </div>

          {others !== null && others.length > 0 && (
            <div className="mt-2 space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-xs font-medium text-muted-foreground">Merge into another vehicle</p>
              <p className="text-[11px] text-muted-foreground">
                Collapses a duplicate: moves all of {vehicle.name}&rsquo;s data into the target vehicle and
                deletes {vehicle.name}. Use this when a backfilled vehicle duplicates one that already exists.
              </p>
              <div className="flex gap-2">
                <select
                  value={mergeTargetId}
                  onChange={e => { setMergeTargetId(e.target.value); setMergeConfirming(false); setMergeErr(null) }}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">Select a vehicle&hellip;</option>
                  {others.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
                {!mergeConfirming && (
                  <Button
                    variant="destructive" size="sm"
                    disabled={!mergeTargetId}
                    onClick={() => setMergeConfirming(true)}
                  >
                    Merge
                  </Button>
                )}
              </div>
              {mergeConfirming && mergeTargetId && (
                <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-2">
                  <p className="text-xs text-destructive">
                    Are you sure? This moves all of {vehicle.name}&rsquo;s data into{' '}
                    {others.find(v => v.id === mergeTargetId)?.name ?? 'the selected vehicle'} and deletes {vehicle.name}.
                    This cannot be undone.
                  </p>
                  {mergeErr && <p className="text-xs text-destructive">{mergeErr}</p>}
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setMergeConfirming(false)} disabled={mergeBusy}>Cancel</Button>
                    <Button variant="destructive" size="sm" onClick={doMerge} disabled={mergeBusy}>
                      {mergeBusy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Confirm merge
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** A vehicle as the link modal needs it: enough to append an alias without clobbering the rest. */
export interface LinkableVehicle {
  id: string
  name: string
  aliases: string[]
}

/**
 * A portfolio-group string with no vehicle behind it. The group came off transactions (usually an
 * import) under a name the registry doesn't know, so it shows no vintage and offers no edit — the
 * group is real, the vehicle record isn't. Two ways out: point the string at an existing vehicle as
 * an alias (the usual case, a renamed or differently-spelled fund), or register it as a new vehicle.
 */
export function VehicleLinkModal({ group, vehicles, onClose, onSaved }: {
  group: string
  vehicles: LinkableVehicle[]
  onClose: () => void
  onSaved: () => void
}) {
  const sorted = useMemo(
    () => [...vehicles].sort((a, b) => a.name.localeCompare(b.name)),
    [vehicles]
  )
  const [mode, setMode] = useState<'link' | 'create'>(sorted.length > 0 ? 'link' : 'create')
  const [targetId, setTargetId] = useState(sorted[0]?.id ?? '')
  const [kind, setKind] = useState('fund')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setBusy(true); setErr(null)
    let res: Response
    if (mode === 'link') {
      const target = sorted.find(v => v.id === targetId)
      if (!target) { setBusy(false); setErr('Pick a vehicle to link to'); return }
      res = await fetch('/api/vehicles', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: target.id, aliases: [...target.aliases, group] }),
      })
    } else {
      res = await fetch('/api/vehicles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: group, kind }),
      })
    }
    setBusy(false)
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? 'Could not save'); return }
    onSaved()
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Link &ldquo;{group}&rdquo; to a vehicle</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            No vehicle in the registry matches this group name, so it has no vintage and nothing to edit.
          </p>

          {sorted.length > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" checked={mode === 'link'} onChange={() => setMode('link')} className="mt-1 h-3.5 w-3.5" />
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block">Add it as an alias of an existing vehicle</span>
                <select
                  value={targetId}
                  onChange={e => { setTargetId(e.target.value); setMode('link') }}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  {sorted.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </span>
            </label>
          )}

          <label className="flex items-start gap-2 text-sm">
            <input type="radio" checked={mode === 'create'} onChange={() => setMode('create')} className="mt-1 h-3.5 w-3.5" />
            <span className="min-w-0 flex-1 space-y-1">
              <span className="block">Register it as a new vehicle</span>
              <select
                value={kind}
                onChange={e => { setKind(e.target.value); setMode('create') }}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </span>
          </label>

          {err && <p className="text-xs text-destructive">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={busy}>{busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
