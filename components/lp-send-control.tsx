'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useLpPortalEnabled } from '@/components/feature-visibility-context'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Loader2, Send, CheckCircle2 } from 'lucide-react'

interface Investor { id: string; name: string }

type Delivery = 'link' | 'attachment' | 'both'
type SendResult = { sent: number; primaryRecipients: number; ccRecipients: number; failures: string[] }

const DELIVERY_OPTIONS: { value: Delivery; label: string; hint: string }[] = [
  { value: 'link', label: 'Secure portal link', hint: 'LPs sign in to view and download.' },
  { value: 'attachment', label: 'PDF attachment', hint: 'Attach the file directly to the email.' },
  { value: 'both', label: 'Both', hint: 'Include the portal link and attach the PDF.' },
]

const KIND_LABEL: Record<'snapshot' | 'letter' | 'document', string> = {
  snapshot: 'statement', letter: 'letter', document: 'document',
}

/**
 * A "Send to LPs" button + modal. Lets a GP email an already-shared item
 * (snapshot, letter, or uploaded document) to selected LPs via checkboxes /
 * select-all, choosing how it's delivered (link / attachment / both). Authorized
 * users on each LP's account are Cc'd automatically by the API. The eligible
 * recipients are exactly the investors the item is shared with — resolved by the
 * send endpoint's GET so all item kinds work uniformly.
 */
export function LpSendControl({ kind, id, itemTitle }: {
  kind: 'snapshot' | 'letter' | 'document'; id: string; itemTitle?: string
}) {
  const lpPortalEnabled = useLpPortalEnabled()
  const [open, setOpen] = useState(false)
  const [eligible, setEligible] = useState<Investor[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [portalEnabled, setPortalEnabled] = useState<boolean | null>(null)

  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [delivery, setDelivery] = useState<Delivery>('link')

  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SendResult | null>(null)

  const kindLabel = KIND_LABEL[kind]

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch(`/api/lps/send?kind=${kind}&id=${encodeURIComponent(id)}`)
      .then(r => (r.ok ? r.json() : { investors: [], portalEnabled: null }))
      .then(data => {
        const invs = (Array.isArray(data.investors) ? data.investors : []).map((i: any) => ({ id: i.id, name: i.name }))
        setEligible(invs)
        setSelected(new Set(invs.map((i: Investor) => i.id))) // default: everyone who can see it
        setPortalEnabled(data.portalEnabled ?? null)
      })
      .finally(() => setLoading(false))
  }, [open, kind, id])

  const allSelected = eligible.length > 0 && eligible.every(i => selected.has(i.id))

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  async function send() {
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/lps/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, lp_investor_ids: Array.from(selected), subject, message, delivery }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error || 'Could not send.'); return }
      setResult(body as SendResult)
    } catch {
      setError('Could not send.')
    } finally {
      setSending(false)
    }
  }

  function reset() {
    setResult(null)
    setError(null)
    setSubject('')
    setMessage('')
    setDelivery('link')
  }

  // With the portal off there is nobody to send to: for a snapshot or a letter the eligible
  // recipients ARE the investors the item is shared with (app/api/lps/send/route.ts), and
  // sharing is a portal action. So the dialog would open onto an empty list. Hooks run
  // first, then bail, so the hook order never changes.
  if (!lpPortalEnabled) return null

  return (
    <>
      <Button variant="outline" size="sm" className="text-muted-foreground" onClick={() => { reset(); setOpen(true) }}>
        <Send className="h-4 w-4 mr-1" />
        Send to LPs
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Send to LPs</DialogTitle>
            <DialogDescription>
              Email this {kindLabel} to selected LPs. Authorized users on each LP&apos;s account are included automatically.
            </DialogDescription>
          </DialogHeader>

          {result ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-md border border-emerald-300/50 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  Sent to {result.sent} LP{result.sent === 1 ? '' : 's'}
                  {result.ccRecipients > 0 && `, plus ${result.ccRecipients} authorized user${result.ccRecipients === 1 ? '' : 's'}`}.
                  {result.failures.length > 0 && (
                    <div className="text-amber-700 dark:text-amber-400 mt-1">{result.failures.length} failed: {result.failures.join(', ')}</div>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={reset}>Send another</Button>
                <Button size="sm" onClick={() => setOpen(false)}>Done</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 min-w-0">
              {portalEnabled === false && delivery !== 'attachment' && (
                <div className="text-xs rounded-md border border-amber-300/50 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 px-2.5 py-2">
                  The LP portal is off, so portal links won&apos;t work. Enable it in{' '}
                  <a href="/settings" className="underline">Settings → LP Portal</a>, or send as a PDF attachment.
                </div>
              )}

              {loading ? (
                <div className="text-xs text-muted-foreground py-4"><Loader2 className="h-3.5 w-3.5 inline animate-spin mr-1" /> Loading…</div>
              ) : eligible.length === 0 ? (
                <div className="text-xs text-muted-foreground py-4">
                  This {kindLabel} isn&apos;t shared with any LPs yet.{kind === 'document' ? ' Share it from the upload form above.' : ' Use “Share with LPs” first.'}
                </div>
              ) : (
                <>
                  {/* Recipients */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-muted-foreground">Recipients ({selected.size} of {eligible.length})</label>
                      <button onClick={() => setSelected(allSelected ? new Set() : new Set(eligible.map(i => i.id)))} className="text-[11px] text-primary hover:underline">
                        {allSelected ? 'Deselect all' : 'Select all'}
                      </button>
                    </div>
                    <div className="rounded-md border divide-y max-h-[28vh] overflow-y-auto min-w-0">
                      {eligible.map(inv => (
                        <label key={inv.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/30 min-w-0">
                          <input type="checkbox" checked={selected.has(inv.id)} onChange={() => toggle(inv.id)} className="h-3.5 w-3.5 shrink-0" />
                          <span className="flex-1 min-w-0 truncate">{inv.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Delivery */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Delivery</label>
                    <div className="grid grid-cols-3 gap-2">
                      {DELIVERY_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => setDelivery(opt.value)}
                          title={opt.hint}
                          className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${
                            delivery === opt.value ? 'border-primary bg-primary/5 text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/40'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground">{DELIVERY_OPTIONS.find(o => o.value === delivery)?.hint}</p>
                  </div>

                  {/* Subject + message */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Subject</label>
                    <input
                      value={subject}
                      onChange={e => setSubject(e.target.value)}
                      placeholder={itemTitle ? `${itemTitle}` : 'Optional — a default is used if blank'}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Message</label>
                    <textarea
                      value={message}
                      onChange={e => setMessage(e.target.value)}
                      rows={4}
                      placeholder="Write a short note to your LPs…"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
                    />
                  </div>

                  {error && <div className="text-xs rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-2 text-destructive">{error}</div>}

                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={sending}>Cancel</Button>
                    <Button size="sm" onClick={send} disabled={sending || selected.size === 0}>
                      {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                      Send to {selected.size} LP{selected.size === 1 ? '' : 's'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
