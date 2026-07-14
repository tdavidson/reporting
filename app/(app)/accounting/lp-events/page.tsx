import type { Metadata } from 'next'
import { requireAccountingAccess } from '../guard'
import { LpEventsView } from './view'

export const metadata: Metadata = { title: 'LP capital events' }

export default async function LpEventsPage() {
  await requireAccountingAccess()
  return (
    <div className="px-4 md:pl-8 md:pr-4 pt-3 pb-8 w-full">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">LP capital events</h1>
        <p className="text-sm text-muted-foreground">
          Capital movements for a vehicle you don&rsquo;t keep double-entry books on &mdash; an SPV, a
          direct investment, a fund whose administrator sends you a statement. These feed the same
          capital accounts, statements and LP report as a full ledger does.
        </p>
      </div>
      <LpEventsView />
    </div>
  )
}
