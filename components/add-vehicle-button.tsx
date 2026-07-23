'use client'

import { useState } from 'react'
import { Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

const KINDS = [
  { value: 'fund', label: 'Fund' },
  { value: 'spv', label: 'SPV' },
  { value: 'direct', label: 'Direct deal' },
  { value: 'associate', label: 'GP / associate entity' },
  { value: 'other', label: 'Other' },
]

/** Create an investment vehicle (fund / SPV / direct deal / …) from a modal. */
export function AddVehicleButton({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState('fund')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function create() {
    if (!name.trim()) return
    setBusy(true); setErr(null)
    const res = await fetch('/api/vehicles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), kind }),
    })
    setBusy(false)
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? 'Could not create vehicle'); return }
    setName(''); setKind('fund'); setOpen(false)
    onCreated?.()
  }

  return (
    <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) setErr(null) }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 h-8 py-2 text-muted-foreground hover:text-foreground">
          <Plus className="h-3.5 w-3.5" />Add vehicle
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add investment vehicle</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Name</label>
            <Input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') create() }} placeholder="e.g. Fund IV, SPV — Acme" autoFocus />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Type</label>
            <select value={kind} onChange={e => setKind(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
              {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </div>
          {err && <p className="text-xs text-destructive">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={create} disabled={busy || !name.trim()}>{busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Add vehicle</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
