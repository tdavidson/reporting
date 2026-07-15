'use client'

// Which producer this vehicle's capital accounts read from — the ledger, or capital events.
//
// Shown in BOTH modes on purpose. It cannot live inside the events-only block: a vehicle
// that is on the ledger would then have no way back, and a vehicle's source is the one
// setting that decides what every other control on this page even means.

import { useEffect, useState } from 'react'
import { BookOpen, ListTree } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { useLedgerFetch } from '@/components/accounting-vehicle'

export type CapitalSource = 'ledger' | 'events'

export function CapitalSourceCard({
  source: sourceProp,
  onChange,
}: {
  /** Omit to have the card fetch (and own) the vehicle's source itself — how it renders on
   *  the Admin page, which has no capital data of its own to hand it. */
  source?: CapitalSource
  onChange?: (next: CapitalSource) => void
} = {}) {
  const lf = useLedgerFetch()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fetched, setFetched] = useState<CapitalSource | null>(null)

  // Self-fetch only when no source was passed in. The capital-accounts page already knows it
  // and passes it; the Admin page does not.
  useEffect(() => {
    if (sourceProp !== undefined) return
    lf('/api/accounting/capital-accounts')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setFetched(d?.source === 'ledger' ? 'ledger' : 'events'))
      .catch(() => setFetched('events'))
  }, [lf, sourceProp])

  const source = sourceProp ?? fetched
  if (!source) return null
  const isLedger = source === 'ledger'

  async function switchTo(next: CapitalSource) {
    setBusy(true); setError(null)
    const res = await lf('/api/accounting/lp-events', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capitalSource: next }),
    })
    setBusy(false)
    if (!res.ok) {
      // The API refuses ledger promotion when the vehicle has no chart of accounts —
      // its LP capital would otherwise read as zero everywhere at once.
      setError((await res.json().catch(() => ({}))).error ?? 'Could not change the capital source')
      return
    }
    if (sourceProp === undefined) setFetched(next)
    onChange?.(next)
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              {isLedger ? <BookOpen className="h-4 w-4" /> : <ListTree className="h-4 w-4" />}
              This vehicle uses{' '}
              <Badge variant={isLedger ? 'default' : 'secondary'}>
                {isLedger ? 'Fund Accounting' : 'LP only tracking'}
              </Badge>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {isLedger
                ? 'Double-entry books to produce full financial statements.'
                : 'Limited partner capital tracking only — no ledger, close, or statements.'}
            </p>
          </div>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => switchTo(isLedger ? 'events' : 'ledger')}>
            Switch to {isLedger ? 'LP only tracking' : 'Fund Accounting'}
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
