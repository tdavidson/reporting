'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Upload, Check, Clock, AlertCircle, MinusCircle, Pencil } from 'lucide-react'
import { DocumentViewer, type ViewerDoc } from '@/components/portal/document-viewer'
import type { OnboardingKind, OnboardingStatus } from '@/lib/lp-onboarding'

interface Item {
  kind: OnboardingKind
  label: string
  help: string
  status: OnboardingStatus
  expired: boolean
  documentId: string | null
  submittedAt: string | null
  reviewedAt: string | null
  expiresOn: string | null
  note: string | null
  documents: { id: string; fileName: string; addedAt: string; mine: boolean }[]
}
interface Entity {
  id: string
  name: string
  fundName: string
  outstanding: number
  complete: boolean
  closing: { name: string; closeDate: string; phrase: string; daysToClose: number | null } | null
  items: Item[]
}

function fmtDate(s: string | null): string {
  if (!s) return ''
  const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function StatusLine({ it }: { it: Item }) {
  if (it.expired) return <span className="inline-flex items-center gap-1 text-foreground"><AlertCircle className="h-3.5 w-3.5 text-warning" /> Expired {fmtDate(it.expiresOn)} — please send a current one</span>
  switch (it.status) {
    case 'verified': return <span className="inline-flex items-center gap-1 text-success"><Check className="h-3.5 w-3.5" /> Received{it.reviewedAt ? ` ${fmtDate(it.reviewedAt)}` : ''}{it.expiresOn ? ` · valid until ${fmtDate(it.expiresOn)}` : ''}</span>
    case 'submitted': return <span className="inline-flex items-center gap-1 text-info"><Clock className="h-3.5 w-3.5" /> Uploaded {fmtDate(it.submittedAt)} — being reviewed</span>
    case 'rejected': return <span className="inline-flex items-center gap-1 text-destructive"><AlertCircle className="h-3.5 w-3.5" /> Please re-send{it.note ? `: ${it.note}` : ''}</span>
    case 'waived': return <span className="inline-flex items-center gap-1 text-muted-foreground"><MinusCircle className="h-3.5 w-3.5" /> Not needed{it.note ? ` — ${it.note}` : ''}</span>
    default: return <span className="text-muted-foreground">Not yet received</span>
  }
}

/**
 * The LP's onboarding checklist: what the fund needs for each of their entities, and the one
 * place an LP uploads to the platform. A file goes straight to storage on a signed URL, then is
 * recorded against the item; the fund reviews it and the status here changes.
 */
export default function PortalOnboardingPage() {
  const supabase = createClient()
  const [entities, setEntities] = useState<Entity[]>([])
  const [maxBytes, setMaxBytes] = useState(25 * 1024 * 1024)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null) // `${entityId}:${kind}`
  const [viewerDoc, setViewerDoc] = useState<ViewerDoc | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [consent, setConsent] = useState<{ disclosure: string; canConsent: boolean }>({ disclosure: '', canConsent: false })
  const [consenting, setConsenting] = useState<string | null>(null)

  async function giveConsent(entityId: string) {
    setError(null); setConsenting(entityId)
    const res = await fetch('/api/portal/onboarding/consent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lp_entity_id: entityId }) })
    setConsenting(null)
    if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.error ?? 'Could not record your consent'); return }
    load()
  }

  async function withdraw(documentId: string) {
    setError(null)
    const res = await fetch('/api/portal/onboarding', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document_id: documentId }) })
    const b = await res.json().catch(() => ({}))
    if (!res.ok) { setError(b.error ?? 'Could not remove the file'); return }
    load()
  }

  async function rename() {
    if (!renaming) return
    setError(null)
    const res = await fetch('/api/portal/onboarding', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lp_entity_id: renaming.id, entity_name: renaming.name }) })
    const b = await res.json().catch(() => ({}))
    if (!res.ok) { setError(b.error ?? 'Could not rename'); return }
    setRenaming(null)
    load()
  }

  const load = useCallback(() => {
    fetch('/api/portal/onboarding')
      .then(r => (r.ok ? r.json() : { entities: [] }))
      .then(b => { setEntities(b.entities ?? []); if (b.maxBytes) setMaxBytes(b.maxBytes); setConsent({ disclosure: b.disclosure ?? '', canConsent: !!b.canConsent }) })
      .catch(() => setError('Could not load your checklist.'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  async function upload(entity: Entity, item: Item, file: File) {
    setError(null)
    if (file.size > maxBytes) { setError('That file is too large (25 MB max).'); return }
    const key = `${entity.id}:${item.kind}`
    setUploading(key)
    try {
      const u = await fetch('/api/portal/onboarding/upload-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lp_entity_id: entity.id, file_name: file.name, mime_type: file.type || null }),
      })
      if (!u.ok) { const b = await u.json().catch(() => ({})); throw new Error(b.error ?? 'Could not start the upload') }
      const { storage_path, token } = await u.json()
      const { error: upErr } = await supabase.storage.from('lp-documents').uploadToSignedUrl(storage_path, token, file)
      if (upErr) throw upErr
      const res = await fetch('/api/portal/onboarding', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lp_entity_id: entity.id, kind: item.kind, storage_path, file_name: file.name, mime_type: file.type || null, size_bytes: file.size }),
      })
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error ?? 'Could not record the upload') }
      load()
    } catch (e: any) {
      setError(e?.message ?? 'Upload failed')
    } finally {
      setUploading(null)
    }
  }

  const totalOutstanding = entities.reduce((n, e) => n + e.outstanding, 0)

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Onboarding</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The documents your fund needs on file for each of your entities. Signing happens outside the portal; upload the executed copy here, as a PDF or a photo, and the fund will confirm it.
        </p>
      </div>

      {error && <div className="rounded-md border border-destructive/40 bg-destructive-subtle px-3 py-2 text-sm text-destructive">{error}</div>}

      {loading ? (
        <div className="text-sm text-muted-foreground"><Loader2 className="h-4 w-4 inline animate-spin mr-1" /> Loading…</div>
      ) : entities.length === 0 ? (
        <div className="rounded-card border bg-card p-6 text-sm text-muted-foreground">Nothing is needed from you right now.</div>
      ) : (
        <>
          <div className={`text-sm ${totalOutstanding === 0 ? 'text-success' : 'text-muted-foreground'}`}>
            {totalOutstanding === 0 ? 'Everything is on file. Thank you.' : `${totalOutstanding} item${totalOutstanding === 1 ? '' : 's'} still needed.`}
          </div>
          {entities.map(e => (
            <section key={e.id} className="rounded-card border bg-card">
              <div className="px-4 py-3 border-b flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  {renaming?.id === e.id ? (
                    <form className="flex flex-wrap items-center gap-1.5" onSubmit={ev => { ev.preventDefault(); void rename() }}>
                      <input value={renaming.name} onChange={ev => setRenaming({ id: e.id, name: ev.target.value })} autoFocus className="h-8 rounded-md border border-input bg-background px-2 text-sm w-64" placeholder="Legal name of the entity" />
                      <button type="submit" className="h-8 px-2.5 rounded-md bg-primary text-primary-foreground text-xs">Save</button>
                      <button type="button" onClick={() => setRenaming(null)} className="h-8 px-2 text-xs text-muted-foreground">Cancel</button>
                    </form>
                  ) : (
                    <h2 className="text-base font-semibold truncate inline-flex items-center gap-1.5">
                      {e.name}
                      <button type="button" onClick={() => setRenaming({ id: e.id, name: e.name })} className="text-muted-foreground hover:text-foreground" title="Rename — the legal name as it appears on your subscription document" aria-label="Rename entity"><Pencil className="h-3.5 w-3.5" /></button>
                    </h2>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {e.fundName}
                    {e.closing && !e.complete && (
                      <span className={e.closing.daysToClose !== null && e.closing.daysToClose >= 0 && e.closing.daysToClose <= 14 ? ' text-destructive' : ''}>
                        {' · '}Needed {e.closing.phrase}
                      </span>
                    )}
                    {e.closing && e.complete && <span>{' · '}Admitted at {e.closing.name}</span>}
                  </div>
                </div>
                <span className={`text-xs tabular-nums ${e.complete ? 'text-success' : 'text-muted-foreground'}`}>
                  {e.complete ? 'Complete' : `${e.outstanding} needed`}
                </span>
              </div>
              <div className="divide-y">
                {e.items.map(it => {
                  const key = `${e.id}:${it.kind}`
                  const isConsent = it.kind === 'k1_econsent'
                  const canUpload = it.status !== 'waived' && !isConsent
                  const actionable = it.status === 'outstanding' || it.status === 'rejected' || it.expired
                  return (
                    <div key={it.kind} className="px-4 py-3 flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{it.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{it.help}</div>
                        <div className="text-xs mt-1.5"><StatusLine it={it} /></div>
                        {isConsent && actionable && (
                          <div className="mt-2 rounded-md border bg-muted/40 p-2.5 space-y-2">
                            <p className="text-xs text-muted-foreground whitespace-pre-line">{consent.disclosure}</p>
                            {consent.canConsent ? (
                              <button type="button" onClick={() => giveConsent(e.id)} disabled={consenting === e.id}
                                className="inline-flex items-center h-8 px-2.5 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                                {consenting === e.id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                                I consent to electronic delivery
                              </button>
                            ) : (
                              <p className="text-xs text-muted-foreground">Only the investor can give this consent — it is their own election, not something an authorized user does for them.</p>
                            )}
                          </div>
                        )}
                        {it.documents.length > 0 && (
                          <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                            {it.documents.map(d => (
                              <li key={d.id}>
                                <button type="button" className="underline hover:text-foreground" onClick={() => setViewerDoc({ id: d.id, title: d.fileName, file_name: d.fileName, mime_type: null })}>{d.fileName}</button>
                                <span> · {fmtDate(d.addedAt)}</span>
                                {d.mine && it.status === 'submitted' && (
                                  <button type="button" onClick={() => withdraw(d.id)} className="ml-2 text-muted-foreground hover:text-destructive underline">Remove</button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">

                        {canUpload && (
                          <label className={`inline-flex items-center h-8 px-2.5 rounded-md text-xs cursor-pointer ${actionable ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border hover:bg-muted'}`}>
                            {uploading === key ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
                            {it.documents.length > 0 ? 'Add another' : 'Upload'}
                            <input type="file" className="sr-only" accept=".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx" disabled={!!uploading}
                              onChange={ev => { const f = ev.target.files?.[0]; if (f) upload(e, it, f); ev.target.value = '' }} />
                          </label>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
          <p className="text-xs text-muted-foreground">
            Tax forms: the fund records the form&apos;s details from your upload. Only the last four digits of a taxpayer identification number are ever stored outside the signed form itself.
          </p>
        </>
      )}

      {viewerDoc && <DocumentViewer doc={viewerDoc} onClose={() => setViewerDoc(null)} />}
    </div>
  )
}
