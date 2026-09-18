'use client'

import { useState } from 'react'
import { Loader2, Receipt, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useLedgerFetch } from '@/components/accounting-vehicle'
import { useLpPortalEnabled } from '@/components/feature-visibility-context'

type Delivery = 'link' | 'attachment' | 'both'
interface Candidate {
  lineId: string; lpEntityId: string; name: string; received: number; receivedOn: string | null; outstanding: number
  lastReceiptAt: string | null; due: boolean; investorId: string | null
}
interface Result { receipts: { name: string }[]; errors: string[]; send: { sent: number; failures: string[]; skipped: string[] } | null }

/**
 * Receipts for the funded lines of a call: one PDF per partner acknowledging what arrived and
 * when, filed in their portal and emailed. Opens on the lines that are DUE — money arrived after
 * the last receipt — with the rest available to re-send.
 */
export function ReceiptAction({ callId, fmt }: { callId: string; fmt: (v: number) => string }) {
  const lf = useLedgerFetch()
  const lpPortalEnabled = useLpPortalEnabled()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [email, setEmail] = useState(true)
  const [delivery, setDelivery] = useState<Delivery>('both')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  function start() {
    setOpen(true); setResult(null); setError(null); setMessage(''); setLoading(true)
    setEmail(lpPortalEnabled)
    lf('/api/accounting/notices/receipt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId, preview: true }),
    })
      .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error ?? 'Could not load'); return d })
      .then(d => {
        const cs = (d.candidates ?? []) as Candidate[]
        setCandidates(cs)
        setSelected(new Set(cs.filter(c => c.due).map(c => c.lineId)))
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  async function send() {
    setBusy(true); setError(null)
    try {
      const res = await lf('/api/accounting/notices/receipt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId, lineIds: Array.from(selected), email: email ? { message, delivery } : null }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? 'Could not send receipts'); return }
      setResult(d as Result)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
  const dueCount = candidates.filter(c => c.due).length

  return (
    <>
      <Button size="sm" variant="outline" onClick={start}>
        <Receipt className="h-3.5 w-3.5 mr-1" />Receipts
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{result ? 'Receipts sent' : 'Send receipts'}</DialogTitle>
            <DialogDescription>
              A receipt acknowledges what arrived against this call and when, from the ledger. Partners whose money arrived since their last receipt are selected.
            </DialogDescription>
          </DialogHeader>

          {result ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-md border border-success/50 bg-success-subtle dark:bg-success-subtle/30 px-3 py-2.5 text-sm text-success">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  Filed {result.receipts.length} receipt{result.receipts.length === 1 ? '' : 's'} in the portal.
                  {result.send && <div>Emailed {result.send.sent} partner{result.send.sent === 1 ? '' : 's'}.</div>}
                </div>
              </div>
              {(result.errors.length > 0 || (result.send?.failures.length ?? 0) > 0 || (result.send?.skipped.length ?? 0) > 0) && (
                <ul className="space-y-0.5 text-sm text-warning">
                  {result.errors.map((e, i) => <li key={`e${i}`}>{e}</li>)}
                  {result.send?.failures.map((e, i) => <li key={`f${i}`}>Email failed — {e}</li>)}
                  {result.send?.skipped.map((e, i) => <li key={`s${i}`}>Not emailed — {e}</li>)}
                </ul>
              )}
              <div className="flex justify-end"><Button size="sm" onClick={() => setOpen(false)}>Done</Button></div>
            </div>
          ) : (
            <div className="space-y-4 min-w-0">
              {loading ? (
                <div className="text-xs text-muted-foreground py-4"><Loader2 className="h-3.5 w-3.5 inline animate-spin mr-1" /> Loading…</div>
              ) : candidates.length === 0 ? (
                <div className="text-sm text-muted-foreground py-2">Nothing has been funded against this call yet.</div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Funded lines ({selected.size} of {candidates.length}{dueCount > 0 ? `, ${dueCount} due` : ''})</label>
                  <div className="rounded-md border divide-y max-h-[30vh] overflow-y-auto min-w-0">
                    {candidates.map(c => (
                      <label key={c.lineId} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/30 min-w-0">
                        <input type="checkbox" checked={selected.has(c.lineId)} onChange={() => toggle(c.lineId)} className="h-3.5 w-3.5 shrink-0" />
                        <span className="flex-1 min-w-0 truncate">{c.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {c.receivedOn ? `received ${c.receivedOn}` : ''}{c.lastReceiptAt ? ` · receipted ${fmtDate(c.lastReceiptAt)}` : ''}
                        </span>
                        <span className="tabular-nums text-muted-foreground shrink-0">{fmt(c.received)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {candidates.length > 0 && (
                <>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={email} onChange={e => setEmail(e.target.checked)} disabled={!lpPortalEnabled} className="h-3.5 w-3.5" />
                    Email each partner their receipt
                    {!lpPortalEnabled && <span className="text-xs text-muted-foreground">(portal is off)</span>}
                  </label>
                  {email && (
                    <>
                      <div className="flex flex-wrap gap-3 text-sm">
                        {(['both', 'link', 'attachment'] as Delivery[]).map(v => (
                          <label key={v} className="flex items-center gap-1.5 cursor-pointer">
                            <input type="radio" name="receipt-delivery" checked={delivery === v} onChange={() => setDelivery(v)} className="h-3.5 w-3.5" />
                            {v === 'both' ? 'Link and attachment' : v === 'link' ? 'Portal link' : 'PDF attachment'}
                          </label>
                        ))}
                      </div>
                      <textarea value={message} onChange={e => setMessage(e.target.value)} rows={2} placeholder="Optional message, e.g. Thank you — your contribution has been received." className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm" />
                    </>
                  )}
                </>
              )}

              {error && <div className="text-sm rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-2 text-destructive">{error}</div>}

              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
                <Button size="sm" onClick={send} disabled={busy || selected.size === 0}>
                  {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Receipt className="h-4 w-4 mr-1" />}
                  {email ? `Send ${selected.size} receipt${selected.size === 1 ? '' : 's'}` : `File ${selected.size} receipt${selected.size === 1 ? '' : 's'}`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
