'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { useLedgerFetch, useVehicleBase } from '@/components/accounting-vehicle'

/**
 * The state of a ledger page — journal, bank, general ledger — for an entity whose chart of
 * accounts has not been seeded. Nothing on these pages works without one: a bank import needs
 * 1000 Cash to post against, a journal entry needs accounts to pick, a register needs an account
 * to show. So instead of an empty picker or an import box that fails on submit, the page says so
 * and points at Admin, where the chart is set up.
 */
export function NoBooksState({ children }: { children?: React.ReactNode }) {
  const base = useVehicleBase()
  return (
    <EmptyState
      action={(
        <Button size="sm" variant="outline" asChild>
          <Link href={base ? `${base}/status` : '/funds/status'}>Set up the books in Admin</Link>
        </Button>
      )}
    >
      {children ?? 'No accounts are set up for this entity yet.'}
    </EmptyState>
  )
}

/**
 * Whether the selected vehicle has any accounts at all. `null` while it is still being asked, so
 * a page can keep its own loading state until the answer is in and never flash the empty state
 * over real content. The bank view already loads the chart and does not need this.
 */
export function useChartExists(): boolean | null {
  const lf = useLedgerFetch()
  const [exists, setExists] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    lf('/api/accounting/chart')
      .then(r => (r.ok ? r.json() : []))
      .then(chart => { if (live) setExists(Array.isArray(chart) && chart.length > 0) })
      // A failed request is not an empty chart: leave the page to its own error handling.
      .catch(() => { if (live) setExists(true) })
    return () => { live = false }
  }, [lf])
  return exists
}
