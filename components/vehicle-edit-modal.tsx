'use client'

import { useState } from 'react'
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

  function addAlias() {
    const a = aliasInput.trim()
    if (a && !aliases.includes(a)) setAliases(prev => [...prev, a])
    setAliasInput('')
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
