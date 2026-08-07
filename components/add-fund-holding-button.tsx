'use client'

import { useState } from 'react'
import { Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'

/**
 * Adds a holding that is itself a FUND.
 *
 * This control is deliberately NOT gated on the fund-of-funds surfaces being active: creating
 * the first fund holding is what activates them (lib/portfolio/fof.ts). Gating it on the state
 * it produces would make the feature unreachable.
 */
export function AddFundHoldingButton({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '', managerName: '', vintageYear: '', strategy: '', commitment: '',
  })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  async function save() {
    if (!form.name.trim()) { setError('A fund name is required.'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/portfolio/fund-holdings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          managerName: form.managerName.trim() || null,
          vintageYear: form.vintageYear ? Number(form.vintageYear) : null,
          strategy: form.strategy.trim() || null,
          commitment: form.commitment ? Number(form.commitment) : 0,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json?.error ?? 'Could not create the fund holding.'); return }
      setOpen(false)
      setForm({ name: '', managerName: '', vintageYear: '', strategy: '', commitment: '' })
      onCreated?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" />Add fund</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an underlying fund</DialogTitle>
          <DialogDescription>
            A fund you have committed capital to. Calls, distributions and manager NAVs are
            recorded against it once it exists.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="fh-name">Fund name</Label>
            <Input id="fh-name" value={form.name} onChange={set('name')} placeholder="Acme Ventures III" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fh-manager">Manager</Label>
            <Input id="fh-manager" value={form.managerName} onChange={set('managerName')} placeholder="Acme Capital" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="fh-vintage">Vintage year</Label>
              <Input id="fh-vintage" type="number" value={form.vintageYear} onChange={set('vintageYear')} placeholder="2021" className="tabular-nums" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fh-commitment">Commitment</Label>
              <Input id="fh-commitment" type="number" value={form.commitment} onChange={set('commitment')} placeholder="5000000" className="tabular-nums" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="fh-strategy">Strategy</Label>
            <Input id="fh-strategy" value={form.strategy} onChange={set('strategy')} placeholder="Early stage venture" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Add fund
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
