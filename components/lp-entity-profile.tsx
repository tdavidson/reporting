'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Plus, X } from 'lucide-react'
import { ENTITY_TYPES, ENTITY_TYPE_LABEL, profileGaps, type Signatory } from '@/lib/lp-profile'

export interface EntityProfileData {
  entity_type: string | null
  formation_jurisdiction: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  region: string | null
  postal_code: string | null
  country: string | null
  notice_email: string | null
  signatories: Signatory[]
  profile_notes: string | null
  profile_updated_at: string | null
}
export interface InvestorContactData {
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
}

/**
 * The investor record beyond a name: entity type, jurisdiction, address, notice email, who
 * signs, and the relationship contact. What a subscription document is filled from, and where
 * an onboarding request goes when there is no portal account.
 */
export function LpEntityProfile({ entityId, entityName, investorName, entity, investor, onSaved }: {
  entityId: string
  entityName: string
  investorName: string
  entity: EntityProfileData
  investor: InvestorContactData
  onSaved: () => void
}) {
  const [e, setE] = useState<EntityProfileData>(entity)
  const [inv, setInv] = useState<InvestorContactData>(investor)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const gaps = profileGaps(e, inv)

  const setField = (k: keyof EntityProfileData, v: string) => setE(p => ({ ...p, [k]: v }))
  const setSig = (i: number, patch: Partial<Signatory>) => setE(p => ({ ...p, signatories: p.signatories.map((s, j) => (j === i ? { ...s, ...patch } : s)) }))

  async function save() {
    setBusy(true); setMsg(null)
    const res = await fetch('/api/lps/entities/profile', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lp_entity_id: entityId,
        entity: {
          entity_type: e.entity_type ?? '', formation_jurisdiction: e.formation_jurisdiction ?? '', address_line1: e.address_line1 ?? '', address_line2: e.address_line2 ?? '',
          city: e.city ?? '', region: e.region ?? '', postal_code: e.postal_code ?? '', country: e.country ?? '', notice_email: e.notice_email ?? '',
          signatories: e.signatories, profile_notes: e.profile_notes ?? '',
        },
        investor: { contact_name: inv.contact_name ?? '', contact_email: inv.contact_email ?? '', contact_phone: inv.contact_phone ?? '' },
      }),
    })
    const b = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setMsg(b.error ?? 'Could not save.'); return }
    setMsg('Saved.')
    onSaved()
  }

  const field = (label: string, k: keyof EntityProfileData, placeholder = '', className = '') => (
    <label className={`text-muted-foreground ${className}`}>{label}
      <Input value={(e[k] as string | null) ?? ''} onChange={ev => setField(k, ev.target.value)} placeholder={placeholder} className="mt-1 h-8 text-xs" />
    </label>
  )

  return (
    <div className="rounded-md border bg-muted/20 p-3 text-xs space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Profile — {entityName}</span>
        {gaps.length > 0
          ? <span className="text-muted-foreground">Still needed for a subscription document: {gaps.join(', ')}.</span>
          : <span className="text-success">Complete.</span>}
        {msg && <span className={msg === 'Saved.' ? 'text-success' : 'text-destructive'}>{msg}</span>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="text-muted-foreground">Entity type
          <select value={e.entity_type ?? ''} onChange={ev => setField('entity_type', ev.target.value)} className="mt-1 block h-8 w-full rounded-md border border-input bg-background px-2 text-xs">
            <option value="">—</option>
            {ENTITY_TYPES.map(t => <option key={t} value={t}>{ENTITY_TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        {field('Formation jurisdiction', 'formation_jurisdiction', 'Delaware')}
        {field('Notice email', 'notice_email', 'notices@investor.com')}
        {field('Address', 'address_line1', 'Street', 'sm:col-span-2')}
        {field('Address line 2', 'address_line2')}
        {field('City', 'city')}
        {field('State / region', 'region')}
        {field('Postal code', 'postal_code')}
        {field('Country', 'country', 'United States')}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-muted-foreground">Signatories</span>
          <button type="button" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setE(p => ({ ...p, signatories: [...p.signatories, { name: '', title: null, email: null }] }))}>
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
        {e.signatories.length === 0 && <div className="text-muted-foreground">Nobody yet. Who signs for this entity?</div>}
        <div className="space-y-1">
          {e.signatories.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5">
              <Input value={s.name} onChange={ev => setSig(i, { name: ev.target.value })} placeholder="Name" className="h-8 text-xs w-44" />
              <Input value={s.title ?? ''} onChange={ev => setSig(i, { title: ev.target.value || null })} placeholder="Title" className="h-8 text-xs w-40" />
              <Input value={s.email ?? ''} onChange={ev => setSig(i, { email: ev.target.value || null })} placeholder="Email" className="h-8 text-xs w-52" />
              <button type="button" aria-label="Remove signatory" className="text-muted-foreground hover:text-destructive" onClick={() => setE(p => ({ ...p, signatories: p.signatories.filter((_, j) => j !== i) }))}><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="sm:col-span-3 text-muted-foreground">Relationship contact for {investorName}. Onboarding requests go here when there is no portal account.</div>
        <label className="text-muted-foreground">Name
          <Input value={inv.contact_name ?? ''} onChange={ev => setInv(p => ({ ...p, contact_name: ev.target.value }))} className="mt-1 h-8 text-xs" />
        </label>
        <label className="text-muted-foreground">Email
          <Input value={inv.contact_email ?? ''} onChange={ev => setInv(p => ({ ...p, contact_email: ev.target.value }))} className="mt-1 h-8 text-xs" />
        </label>
        <label className="text-muted-foreground">Phone
          <Input value={inv.contact_phone ?? ''} onChange={ev => setInv(p => ({ ...p, contact_phone: ev.target.value }))} className="mt-1 h-8 text-xs" />
        </label>
      </div>

      <label className="block text-muted-foreground">Notes
        <Textarea value={e.profile_notes ?? ''} onChange={ev => setField('profile_notes', ev.target.value)} rows={2} className="mt-1 text-xs" placeholder="ERISA status, special notice instructions, anything counsel should know." />
      </label>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy}>{busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />} Save profile</Button>
        {e.profile_updated_at && <span className="text-muted-foreground">Last updated {new Date(e.profile_updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
      </div>
    </div>
  )
}
