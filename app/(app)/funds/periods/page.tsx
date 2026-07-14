import type { Metadata } from 'next'
import { requireAccountingAccess } from '../guard'
import { PeriodsView } from './view'

export const metadata: Metadata = { title: 'Period close' }

export default async function PeriodsPage() {
  await requireAccountingAccess()
  return (
    <div className="px-4 md:pl-8 md:pr-4 pt-3 pb-8 w-full">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Period close</h1>
        <p className="text-sm text-muted-foreground">
          Closing a period allocates its income and expenses to each partner&rsquo;s capital account,
          snapshots the ledger, and freezes the books for that date range. New postings dated inside
          it are blocked until you reopen.
        </p>
      </div>
      <PeriodsView />
    </div>
  )
}
