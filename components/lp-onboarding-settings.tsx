'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, Check, X, MinusCircle, RotateCcw, Upload, Send, ChevronDown, ChevronRight, History, UserSquare } from 'lucide-react'
import { ONBOARDING_STATUS_LABEL, type OnboardingKind, type OnboardingStatus } from '@/lib/lp-onboarding'
import { LpOnboardingSort } from '@/components/lp-onboarding-sort'
import { TaxFormFields, taxFieldsFromFacts, taxFieldsToBody, EMPTY_TAX_FIELDS, type TaxFormFieldsValue } from '@/components/lp-tax-form-fields'
import { LpEntityProfile, type EntityProfileData, type InvestorContactData } from '@/components/lp-entity-profile'
import { profileGaps } from '@/lib/lp-profile'

interface Item {
  kind: OnboardingKind
  label: string
  status: OnboardingStatus
  expired: boolean
  itemId: string | null
  documentId: string | null
  document: { title: string; file_name: string; mime_type: string | null } | null
  documents: { id: string; title: string; file_name: string; mime_type: string | null; added_at: string; uploaded_by: string | null }[]
  submittedAt: string | null
  reviewedAt: string | null
  expiresOn: string | null
  note: string | null
}
interface EntityRow {
  id: string
  name: string
  investorId: string
  investorName: string
  accountStatus: string | null
  profile: { entity: EntityProfileData; investor: InvestorContactData } | null
  closing: { id: string; name: string; closeDate: string; vehicle: string } | null
  daysToClose: number | null
  items: Item[]
  outstanding: number
  awaitingReview: number
  complete: boolean
}
interface Payload {
  portalEnabled: boolean
  canRecordTax: boolean
  kinds: OnboardingKind[]
  allKinds: { kind: OnboardingKind; label: string }[]
  entities: EntityRow[]
}

function fmtDate(s: string | null): string {
  if (!s) return ''
  const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function tone(it: Item): string {
  if (it.expired) return 'bg-warning-subtle text-foreground'
  switch (it.status) {
    case 'verified': return 'bg-success-subtle text-success'
    case 'submitted': return 'bg-info-subtle text-info'
    case 'rejected': return 'bg-destructive-subtle text-destructive'
    case 'waived': return 'bg-muted text-muted-foreground line-through'
    default: return 'bg-muted text-muted-foreground'
  }
}
function statusText(it: Item): string {
  if (it.expired) return 'Expired'
  return ONBOARDING_STATUS_LABEL[it.status]
}

/**
 * The fund's onboarding checklist: which documents it requires, where every entity stands, and
 * the review of what LPs send. Uploads on an LP's behalf go through the ordinary document flow
 * scoped to that investor, then attach to the item as verified — the fund holds the copy.
 */
export function LpOnboardingSettings() {
  const supabase = createClient()
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<'all' | 'attention' | 'incomplete'>('all')
  const [savingKinds, setSavingKinds] = useState(false)

  // Review dialog
  const [review, setReview] = useState<{ entity: EntityRow; item: Item; action: 'rejected' | 'verified' | 'waived' } | null>(null)
  const [note, setNote] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<Record<string, { loading: boolean; events: any[] } | undefined>>({})
  const [profileOpen, setProfileOpen] = useState<Set<string>>(new Set())
  const [tax, setTax] = useState<TaxFormFieldsValue>(EMPTY_TAX_FIELDS)

  function toggleHistory(entityId: string) {
    if (history[entityId]) { setHistory(h => ({ ...h, [entityId]: undefined })); return }
    setHistory(h => ({ ...h, [entityId]: { loading: true, events: [] } }))
    fetch(`/api/lps/onboarding/history?lp_entity_id=${entityId}`)
      .then(r => (r.ok ? r.json() : { events: [] }))
      .then(b => setHistory(h => ({ ...h, [entityId]: { loading: false, events: b.events ?? [] } })))
      .catch(() => setHistory(h => ({ ...h, [entityId]: { loading: false, events: [] } })))
  }
  const [taxReading, setTaxReading] = useState(false)
  const [taxNote, setTaxNote] = useState<string | null>(null)

  // Verifying a tax form: read the uploaded file for a head start on the record.
  function openReview(entity: EntityRow, item: Item, action: 'rejected' | 'verified' | 'waived') {
    setReview({ entity, item, action }); setNote(''); setExpiresOn(''); setTax(EMPTY_TAX_FIELDS); setTaxNote(null)
    if (action === 'verified' && item.kind === 'tax_form' && item.documentId) {
      setTaxReading(true)
      fetch(`/api/lps/onboarding/facts?document_id=${item.documentId}`)
        .then(r => (r.ok ? r.json() : null))
        .then(b => { if (b?.facts) { setTax(taxFieldsFromFacts(b.facts)); if (b.facts.expiresOn) setExpiresOn(b.facts.expiresOn) } if (b?.note) setTaxNote(b.note) })
        .catch(() => {})
        .finally(() => setTaxReading(false))
    }
  }

  // Request dialog
  const [request, setRequest] = useState<{ preview: any } | null>(null)
  const [requestMsg, setRequestMsg] = useState('')
  const [requestResult, setRequestResult] = useState<string | null>(null)

  const load = useCallback(() => {
    return fetch('/api/lps/onboarding')
      .then(async r => (r.ok ? r.json() : Promise.reject(await r.json().catch(() => ({})))))
      .then(setData)
      .catch(b => setError(b?.error ?? 'Could not load onboarding.'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { void load() }, [load])

  const rows = useMemo(() => {
    const all = data?.entities ?? []
    if (filter === 'attention') return all.filter(e => e.awaitingReview > 0)
    if (filter === 'incomplete') return all.filter(e => !e.complete)
    return all
  }, [data, filter])

  const totals = useMemo(() => {
    const all = data?.entities ?? []
    return {
      entities: all.length,
      complete: all.filter(e => e.complete).length,
      awaiting: all.reduce((n, e) => n + e.awaitingReview, 0),
      outstanding: all.reduce((n, e) => n + e.outstanding, 0),
    }
  }, [data])

  // Upcoming closings and how many of their entities are not yet complete — the deadline view.
  const upcoming = useMemo(() => {
    const byClosing = new Map<string, { name: string; closeDate: string; vehicle: string; days: number; total: number; incomplete: number }>()
    for (const e of data?.entities ?? []) {
      if (!e.closing || e.daysToClose === null || e.daysToClose < 0) continue
      const c = byClosing.get(e.closing.id) ?? { name: e.closing.name, closeDate: e.closing.closeDate, vehicle: e.closing.vehicle, days: e.daysToClose, total: 0, incomplete: 0 }
      c.total += 1
      if (!e.complete) c.incomplete += 1
      byClosing.set(e.closing.id, c)
    }
    return Array.from(byClosing.values()).sort((a, b) => a.days - b.days)
  }, [data])

  async function toggleKind(kind: OnboardingKind) {
    if (!data) return
    const next = data.kinds.includes(kind) ? data.kinds.filter(k => k !== kind) : [...data.kinds, kind]
    setSavingKinds(true)
    const res = await fetch('/api/lps/onboarding', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kinds: next }) })
    setSavingKinds(false)
    if (res.ok) load()
  }

  async function patch(entity: EntityRow, item: Item, status: OnboardingStatus, extra: Record<string, unknown> = {}) {
    setBusy(true); setError(null)
    const res = await fetch('/api/lps/onboarding', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lp_entity_id: entity.id, kind: item.kind, status, ...extra }),
    })
    setBusy(false)
    if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.error ?? 'Update failed'); return false }
    load()
    return true
  }

  async function submitReview() {
    if (!review) return
    const isTax = review.action === 'verified' && review.item.kind === 'tax_form'
    const ok = await patch(review.entity, review.item, review.action, {
      note: note || null,
      expires_on: (isTax && tax.expiresOn) ? tax.expiresOn : (expiresOn || null),
      tax: isTax && data?.canRecordTax ? taxFieldsToBody(tax) : null,
    })
    if (ok) { setReview(null); setNote(''); setExpiresOn(''); setTax(EMPTY_TAX_FIELDS) }
  }

  async function uploadFor(entity: EntityRow, item: Item, file: File) {
    setBusy(true); setError(null)
    try {
      const u = await fetch('/api/lps/documents/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_name: file.name }) })
      if (!u.ok) throw new Error('Could not start upload')
      const { storage_path, token } = await u.json()
      const { error: upErr } = await supabase.storage.from('lp-documents').uploadToSignedUrl(storage_path, token, file)
      if (upErr) throw upErr
      const res = await fetch('/api/lps/documents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${item.label} — ${entity.name}`, file_name: file.name, storage_path, mime_type: file.type || null, size_bytes: file.size,
          scope: 'investor', lp_investor_ids: [entity.investorId], category: 'Onboarding', index: false,
        }),
      })
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error ?? 'Save failed') }
      const { id } = await res.json()
      await patch(entity, item, 'verified', { document_id: id })
    } catch (e: any) {
      setError(e?.message ?? 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function openDocument(documentId: string) {
    const r = await fetch(`/api/lps/preview/document/${documentId}`)
    const b = await r.json().catch(() => ({}))
    if (b.url) window.open(b.url, '_blank', 'noopener')
    else setError(b.error ?? 'Could not open the document.')
  }

  async function previewRequest() {
    setRequestResult(null)
    const res = await fetch('/api/lps/onboarding/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preview: true, message: requestMsg || undefined }) })
    const b = await res.json().catch(() => ({}))
    if (!res.ok) { setError(b.error ?? 'Could not build the request.'); return }
    setRequest({ preview: b })
  }
  async function sendRequest() {
    setBusy(true)
    const res = await fetch('/api/lps/onboarding/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: requestMsg || undefined }) })
    const b = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(b.error ?? 'Send failed.'); return }
    setRequest(null)
    setRequestResult(`Sent to ${b.sent} LP${b.sent === 1 ? '' : 's'}${b.failures?.length ? `, ${b.failures.length} failed` : ''}${b.unreachable?.length ? `; ${b.unreachable.length} with no portal account` : ''}.`)
  }

  if (loading && !data) return <div className="text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 inline animate-spin mr-1" /> Loading…</div>
  if (!data) return <div className="text-sm text-destructive">{error ?? 'Could not load onboarding.'}</div>

  return (
    <div className="space-y-5">
      {error && <div className="text-sm text-destructive">{error}</div>}

      {/* Requirement set */}
      <div>
        <h4 className="text-sm font-medium mb-1">Required of every entity</h4>
        <p className="text-xs text-muted-foreground mb-2">
          Signing happens off platform. This is the record of what arrived: LPs upload executed copies through their portal, you review them here. Untick anything your fund does not collect.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {data.allKinds.map(k => {
            const on = data.kinds.includes(k.kind)
            return (
              <button key={k.kind} type="button" onClick={() => toggleKind(k.kind)} disabled={savingKinds}
                className={`rounded-md border px-2 py-1 text-xs transition-colors ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background text-muted-foreground hover:text-foreground'}`}>
                {k.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Summary + actions */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground tabular-nums">
          {totals.complete} of {totals.entities} entities complete · {totals.awaiting} awaiting review · {totals.outstanding} outstanding
        </span>
        <span className="flex-1" />
        <select value={filter} onChange={e => setFilter(e.target.value as any)} className="h-7 rounded-md border border-input bg-background px-2 text-xs">
          <option value="all">All entities</option>
          <option value="attention">Awaiting review</option>
          <option value="incomplete">Incomplete</option>
        </select>
        <Button size="sm" variant="outline" onClick={previewRequest} disabled={busy || !data.portalEnabled || totals.outstanding === 0} title={data.portalEnabled ? undefined : 'Turn on the LP portal first'}>
          <Send className="h-3.5 w-3.5 mr-1" /> Request outstanding
        </Button>
      </div>
      {requestResult && <div className="text-xs text-success">{requestResult}</div>}

      {upcoming.length > 0 && (
        <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs space-y-1">
          {upcoming.map(c => (
            <div key={`${c.vehicle}-${c.name}`} className="flex flex-wrap items-center gap-x-2">
              <span className="font-medium">{c.name}</span>
              <span className="text-muted-foreground">{c.vehicle} · {fmtDate(c.closeDate)} · {c.days === 0 ? 'today' : `in ${c.days} day${c.days === 1 ? '' : 's'}`}</span>
              <span className={`tabular-nums ${c.incomplete > 0 ? 'text-destructive' : 'text-success'}`}>
                {c.incomplete > 0 ? `${c.incomplete} of ${c.total} not complete` : `all ${c.total} complete`}
              </span>
            </div>
          ))}
          <div className="text-muted-foreground">Closings and who is admitted at each are set on the vehicle&apos;s Allocation terms page.</div>
        </div>
      )}

      {/* Sort a batch */}
      <LpOnboardingSort onFiled={() => { void load() }} />

      {/* Entities */}
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">{data.entities.length === 0 ? 'No LP entities yet. Entities come from LP capital tracking or the ledger.' : 'Nothing matches this filter.'}</div>
      ) : (
        <div className="rounded-md border divide-y">
          {rows.map(e => {
            const isOpen = open.has(e.id)
            return (
              <div key={e.id}>
                <button type="button" onClick={() => setOpen(prev => { const n = new Set(prev); n.has(e.id) ? n.delete(e.id) : n.add(e.id); return n })}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors">
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{e.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {e.investorName && e.investorName !== e.name ? `${e.investorName} · ` : ''}
                      {e.accountStatus === 'active' ? 'Portal active' : e.accountStatus === 'invited' ? 'Invited, not yet activated' : 'No portal account'}
                      {e.closing && (
                        <span className={e.daysToClose !== null && e.daysToClose >= 0 && !e.complete && e.daysToClose <= 14 ? ' text-destructive' : ''}>
                          {' · '}{e.closing.name} {fmtDate(e.closing.closeDate)}
                          {e.daysToClose !== null && (e.daysToClose < 0 ? ' (closed)' : e.daysToClose === 0 ? ' (today)' : ` (in ${e.daysToClose}d)`)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="hidden sm:flex flex-wrap gap-1 justify-end max-w-[55%]">
                    {e.items.map(it => (
                      <span key={it.kind} className={`rounded px-1.5 py-0.5 text-[10px] ${tone(it)}`} title={`${it.label}: ${statusText(it)}`}>{it.label}</span>
                    ))}
                  </div>
                  <span className={`text-[11px] tabular-nums shrink-0 ${e.complete ? 'text-success' : e.awaitingReview > 0 ? 'text-info' : 'text-muted-foreground'}`}>
                    {e.complete ? 'Complete' : e.awaitingReview > 0 ? `${e.awaitingReview} to review` : `${e.outstanding} outstanding`}
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t bg-muted/20 divide-y">
                    {e.items.map(it => (
                      <div key={it.kind} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                        <div className="min-w-[180px] flex-1">
                          <div className="font-medium">{it.label}</div>
                          <div className="text-muted-foreground">
                            <span className={`rounded px-1.5 py-0.5 ${tone(it)}`}>{statusText(it)}</span>
                            {it.submittedAt && <span className="ml-2">sent {fmtDate(it.submittedAt)}</span>}
                            {it.reviewedAt && it.status !== 'submitted' && <span className="ml-2">reviewed {fmtDate(it.reviewedAt)}</span>}
                            {it.expiresOn && <span className="ml-2">expires {fmtDate(it.expiresOn)}</span>}
                          </div>
                          {it.note && <div className="text-muted-foreground mt-0.5">Note: {it.note}</div>}
                          {it.documents.length > 0 && (
                            <ul className="mt-1 space-y-0.5 text-muted-foreground">
                              {it.documents.map(d => (
                                <li key={d.id}>
                                  <button type="button" className="underline hover:text-foreground" onClick={() => openDocument(d.id)}>{d.file_name}</button>
                                  <span> · {fmtDate(d.added_at)}{d.uploaded_by ? ` · uploaded by ${d.uploaded_by}` : ' · filed by the fund'}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          {it.status !== 'verified' || it.expired ? (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-success" disabled={busy} onClick={() => openReview(e, it, 'verified')}>
                              <Check className="h-3.5 w-3.5 mr-1" /> Verify
                            </Button>
                          ) : null}
                          {(it.status === 'submitted' || it.status === 'verified') && (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" disabled={busy} onClick={() => openReview(e, it, 'rejected')}>
                              <X className="h-3.5 w-3.5 mr-1" /> Send back
                            </Button>
                          )}
                          {it.status !== 'waived' && it.status !== 'verified' && (
                            <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => openReview(e, it, 'waived')}>
                              <MinusCircle className="h-3.5 w-3.5 mr-1" /> Waive
                            </Button>
                          )}
                          {(it.status === 'waived' || it.status === 'rejected' || (it.status === 'verified' && !it.documentId)) && (
                            <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => patch(e, it, 'outstanding')}>
                              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset
                            </Button>
                          )}
                          <label className="inline-flex items-center h-7 px-2 rounded-md text-xs cursor-pointer hover:bg-muted">
                            <Upload className="h-3.5 w-3.5 mr-1" /> {it.documents.length > 0 ? 'Add a file' : 'Upload for them'}
                            <input type="file" className="sr-only" accept=".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx" disabled={busy}
                              onChange={ev => { const f = ev.target.files?.[0]; if (f) uploadFor(e, it, f); ev.target.value = '' }} />
                          </label>
                        </div>
                      </div>
                    ))}
                    <div className="px-3 py-2 text-xs space-y-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <button type="button" onClick={() => setProfileOpen(p => { const n = new Set(p); n.has(e.id) ? n.delete(e.id) : n.add(e.id); return n })} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                          <UserSquare className="h-3.5 w-3.5" /> {profileOpen.has(e.id) ? 'Hide profile' : 'Profile'}
                          {e.profile && profileGaps(e.profile.entity, e.profile.investor).length > 0 && <span className="rounded px-1.5 py-0.5 text-[10px] bg-warning-subtle text-foreground">{profileGaps(e.profile.entity, e.profile.investor).length} gap{profileGaps(e.profile.entity, e.profile.investor).length === 1 ? '' : 's'}</span>}
                        </button>
                        <button type="button" onClick={() => toggleHistory(e.id)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                          <History className="h-3.5 w-3.5" /> {history[e.id] ? 'Hide history' : 'History'}
                        </button>
                      </div>
                      {profileOpen.has(e.id) && e.profile && (
                        <LpEntityProfile key={`${e.id}-${e.profile.entity.profile_updated_at ?? ''}`} entityId={e.id} entityName={e.name} investorName={e.investorName || e.name} entity={e.profile.entity} investor={e.profile.investor} onSaved={() => { void load() }} />
                      )}
                      {history[e.id] && (
                        history[e.id]!.loading ? <div className="text-muted-foreground mt-1">Loading…</div> : (
                          history[e.id]!.events.length === 0 ? <div className="text-muted-foreground mt-1">Nothing yet.</div> : (
                            <ul className="mt-1 space-y-0.5 text-muted-foreground">
                              {history[e.id]!.events.map((ev: any) => (
                                <li key={ev.id}>
                                  <span className="tabular-nums">{fmtDate(ev.at)}</span> · {ev.kindLabel} {ev.action}{ev.fileName ? ` (${ev.fileName})` : ''}{ev.actor ? ` — ${ev.actor}` : ''}{ev.note ? `: ${ev.note}` : ''}
                                </li>
                              ))}
                            </ul>
                          )
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Review dialog */}
      <Dialog open={!!review} onOpenChange={o => { if (!o) setReview(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {review?.action === 'verified' ? 'Verify' : review?.action === 'rejected' ? 'Send back' : 'Waive'} — {review?.item.label}
            </DialogTitle>
            <DialogDescription>{review?.entity.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {review?.action === 'verified' && review.item.kind === 'tax_form' && (
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">
                  {taxReading ? 'Reading the uploaded form…' : data?.canRecordTax
                    ? 'The form\'s facts, as read from the upload. Verifying records the form for the K-1 in the same step.'
                    : 'The form\'s facts, as read from the upload. Recording them needs tax-reporting access; verifying still files the document.'}
                  {taxNote && !taxReading ? ` ${taxNote}` : ''}
                </div>
                <TaxFormFields value={tax} onChange={setTax} disabled={taxReading || !data?.canRecordTax} />
              </div>
            )}
            {review?.action === 'verified' && review.item.kind !== 'tax_form' && (
              <div className="space-y-1">
                <label className="text-xs font-medium" htmlFor="ob-expires">Expires on (optional)</label>
                <Input id="ob-expires" type="date" value={expiresOn} onChange={e => setExpiresOn(e.target.value)} className="h-8 text-sm w-48" />
                <p className="text-[11px] text-muted-foreground">A W-8 lapses after three calendar years; KYC on whatever cycle your policy sets. Expired items count as outstanding again.</p>
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs font-medium" htmlFor="ob-note">
                {review?.action === 'rejected' ? 'What to send instead (the LP sees this)' : 'Note (optional)'}
              </label>
              <Textarea id="ob-note" value={note} onChange={e => setNote(e.target.value)} rows={3} className="text-sm"
                placeholder={review?.action === 'rejected' ? 'e.g. The signature page is missing the second signatory.' : review?.action === 'waived' ? 'e.g. Paper copy on file from the 2024 close.' : ''} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setReview(null)}>Cancel</Button>
            <Button size="sm" onClick={submitReview} disabled={busy || (review?.action === 'rejected' && !note.trim())}>
              {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              {review?.action === 'verified' ? 'Mark verified' : review?.action === 'rejected' ? 'Send back' : 'Waive'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request dialog */}
      <Dialog open={!!request} onOpenChange={o => { if (!o) setRequest(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Request outstanding documents</DialogTitle>
            <DialogDescription>One email per LP, their authorized users copied, listing what each entity still owes with a link to upload.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="font-medium" htmlFor="ob-req-msg">Message (optional, replaces the default intro)</label>
              <Textarea id="ob-req-msg" value={requestMsg} onChange={e => setRequestMsg(e.target.value)} rows={3} className="text-sm" />
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={previewRequest}>Refresh preview</button>
            </div>
            <div className="max-h-64 overflow-auto rounded-md border divide-y">
              {(request?.preview?.recipients ?? []).map((r: any) => (
                <div key={r.to} className="px-3 py-2">
                  <div className="font-medium">{r.name || r.to} <span className="text-muted-foreground font-normal">{r.to}{r.cc?.length ? ` · cc ${r.cc.join(', ')}` : ''}</span></div>
                  <ul className="mt-1 list-disc pl-4 text-muted-foreground">{r.items.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
                </div>
              ))}
            </div>
            {request && request.preview?.unreachable?.length > 0 && (
              <div className="text-foreground bg-warning-subtle rounded-md px-3 py-2">
                No portal account, so not emailed: {request.preview.unreachable.join(', ')}. Invite them under Access first.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRequest(null)}>Cancel</Button>
            <Button size="sm" onClick={sendRequest} disabled={busy || !(request?.preview?.recipients?.length)}>
              {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />} Send {request?.preview?.recipients?.length ?? 0} email{request?.preview?.recipients?.length === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
