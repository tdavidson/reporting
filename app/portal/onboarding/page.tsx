'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Upload, Check, Clock, AlertCircle, MinusCircle, FileText } from 'lucide-react'
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
}
interface Entity {
  id: string
  name: string
  fundName: string
  outstanding: number
  complete: boolean
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

  const load = useCallback(() => {
    fetch('/api/portal/onboarding')
      .then(r => (r.ok ? r.json() : { entities: [] }))
      .then(b => { setEntities(b.entities ?? []); if (b.maxBytes) setMaxBytes(b.maxBytes) })
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
                  <h2 className="text-base font-semibold truncate">{e.name}</h2>
                  <div className="text-xs text-muted-foreground">{e.fundName}</div>
                </div>
                <span className={`text-xs tabular-nums ${e.complete ? 'text-success' : 'text-muted-foreground'}`}>
                  {e.complete ? 'Complete' : `${e.outstanding} needed`}
                </span>
              </div>
              <div className="divide-y">
                {e.items.map(it => {
                  const key = `${e.id}:${it.kind}`
                  const canUpload = it.status !== 'waived'
                  const actionable = it.status === 'outstanding' || it.status === 'rejected' || it.expired
                  return (
                    <div key={it.kind} className="px-4 py-3 flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{it.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{it.help}</div>
                        <div className="text-xs mt-1.5"><StatusLine it={it} /></div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {it.documentId && (
                          <button type="button" onClick={() => setViewerDoc({ id: it.documentId!, title: it.label, file_name: it.label, mime_type: null })}
                            className="inline-flex items-center h-8 px-2.5 rounded-md border text-xs hover:bg-muted">
                            <FileText className="h-3.5 w-3.5 mr-1" /> View
                          </button>
                        )}
                        {canUpload && (
                          <label className={`inline-flex items-center h-8 px-2.5 rounded-md text-xs cursor-pointer ${actionable ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border hover:bg-muted'}`}>
                            {uploading === key ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
                            {it.documentId ? 'Replace' : 'Upload'}
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
