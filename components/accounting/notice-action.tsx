'use client'

import { useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLedgerFetch } from '@/components/accounting-vehicle'

/**
 * Publish per-partner notices for a declared call or distribution.
 *
 * Publishing, not sending. The document lands in each partner's portal, which is also where it
 * waits until you choose to email it — the same two-step the capital account statement uses.
 *
 * Every figure on the notice comes from the register, so re-publishing reproduces the same
 * amounts even after the call has been part-funded or the distribution paid.
 */
export function NoticeAction({ kind, id }: { kind: 'capital_call' | 'distribution'; id: string }) {
  const lf = useLedgerFetch()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  async function publish() {
    if (!window.confirm('Generate a notice for every partner on this and put it in their portal?')) return
    setBusy(true); setMsg(null); setErrors([])
    try {
      const res = await lf('/api/accounting/notices/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setMsg(d.error ?? 'Could not publish the notices'); return }
      setMsg(`Published ${d.count ?? 0} notice${d.count === 1 ? '' : 's'} to the portal.`)
      // Partial failures are the norm here — an entity with no linked LP investor generates a
      // document nobody can open. Listing them beats a count that quietly under-reports.
      setErrors(Array.isArray(d.errors) ? d.errors : [])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={publish} disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
        Publish notices
      </Button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      {errors.length > 0 && (
        <ul className="w-full space-y-0.5 text-sm text-warning">
          {errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
    </div>
  )
}
