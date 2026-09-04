'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'
import { TAX_FORM_LABEL, TAX_FORM_TYPES, type TaxFormType } from '@/lib/tax/forms'

/**
 * Record a partner's signed W-9 / W-8 from the tax page — the only way one gets on file today,
 * since the portal is GP → LP and the partner cannot upload their own.
 *
 * The signed PDF is optional. When given it goes through the LP-documents flow (signed upload URL
 * → Storage → /api/lps/documents) scoped to that partner's investor alone, so it shows in THEIR
 * portal and nobody else's, and the tax record carries the document id. The form's identification
 * is recorded as it appears on the form; only the last four digits of the TIN are kept — the full
 * number lives in the signed form itself.
 */
export function TaxFormRecord({
  lpEntityId,
  investorId,
  partnerName,
  onSaved,
}: {
  lpEntityId: string
  investorId: string | null
  partnerName: string
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [formType, setFormType] = useState<TaxFormType>('w9')
  const [signedDate, setSignedDate] = useState('')
  const [legalName, setLegalName] = useState('')
  const [tinLast4, setTinLast4] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="h-7" onClick={() => setOpen(true)}>Record form</Button>
    )
  }

  async function uploadDocument(): Promise<string | null> {
    if (!file) return null
    if (!investorId) throw new Error('This partner is not linked to an investor, so the file cannot be filed to their portal. Record the form without it.')
    const u = await fetch('/api/lps/documents/upload-url', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_name: file.name }),
    })
    const up = await u.json().catch(() => ({}))
    if (!u.ok) throw new Error(up?.error ?? 'Could not start the upload')
    const { error: upErr } = await createClient().storage.from('lp-documents').uploadToSignedUrl(up.storage_path, up.token, file)
    if (upErr) throw new Error(upErr.message)
    const res = await fetch('/api/lps/documents', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `${TAX_FORM_LABEL[formType]} — ${partnerName}`,
        file_name: file.name, storage_path: up.storage_path,
        mime_type: file.type || null, size_bytes: file.size,
        scope: 'investor', lp_investor_ids: [investorId],
        category: 'Tax form', doc_date: signedDate || null,
      }),
    })
    const doc = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(doc?.error ?? 'Could not file the document')
    return doc.id as string
  }

  async function save() {
    setBusy(true); setError(null)
    try {
      const documentId = await uploadDocument()
      const res = await fetch('/api/accounting/tax-forms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lpEntityId, formType,
          signedDate: signedDate || null,
          legalName: legalName.trim() || null,
          tinLast4: tinLast4.trim() || null,
          documentId,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error ?? `Could not record the form (${res.status})`)
      setOpen(false)
      onSaved()
    } catch (e: any) {
      setError(e?.message ?? 'Could not record the form')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border bg-muted/20 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          Form
          <select
            value={formType}
            onChange={e => setFormType(e.target.value as TaxFormType)}
            className="block h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
          >
            {TAX_FORM_TYPES.map(t => <option key={t} value={t}>{TAX_FORM_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Signed on
          <Input type="date" value={signedDate} onChange={e => setSignedDate(e.target.value)} className="h-8" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Name as it appears on the form
          <Input value={legalName} onChange={e => setLegalName(e.target.value)} placeholder={partnerName} className="h-8" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          TIN, last four digits only
          <Input value={tinLast4} onChange={e => setTinLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" maxLength={4} className="h-8 font-mono" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
          Signed form (optional, filed to this partner&rsquo;s portal documents)
          <input type="file" accept=".pdf,image/*" onChange={e => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
        </label>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setError(null) }} disabled={busy}>Cancel</Button>
      </div>
    </div>
  )
}
