import type { Metadata } from 'next'
import { requireAccountingAdmin } from '../guard'
import { CapitalCallsView } from './view'

export const metadata: Metadata = { title: 'Capital calls' }

export default async function CapitalCallsPage() {
  await requireAccountingAdmin()
  return (
    <div className="px-4 md:pl-8 md:pr-4 pt-3 pb-8 w-full">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Capital calls</h1>
        <p className="text-sm text-muted-foreground">
          Issue calls against LP commitments and track called vs funded. A call recognizes each LP&apos;s
          contribution and a receivable; the wire that funds it clears the receivable (recorded on the
          Bank transactions page).
        </p>
      </div>
      <CapitalCallsView />
    </div>
  )
}
