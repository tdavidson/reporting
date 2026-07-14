import type { Metadata } from 'next'
import { requireAccountingAccess } from '../guard'
import { ScheduleOfInvestmentsView } from './view'

export const metadata: Metadata = { title: 'Schedule of investments' }

export default async function ScheduleOfInvestmentsPage() {
  await requireAccountingAccess()
  return (
    <div className="px-4 md:pl-8 md:pr-4 pt-3 pb-8 w-full">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Schedule of investments</h1>
        <p className="text-sm text-muted-foreground">
          Each investment at cost and fair value, with its share of net assets — derived from the
          ledger (investment cost + unrealized appreciation).
        </p>
      </div>
      <ScheduleOfInvestmentsView />
    </div>
  )
}
