import type { Metadata } from 'next'
import { requireAccountingAccess } from '../guard'
import { JournalView } from './view'

export const metadata: Metadata = { title: 'Journal' }

export default async function JournalPage() {
  await requireAccountingAccess()
  return (
    <div className="px-4 md:pl-8 md:pr-4 pt-3 pb-8 w-full">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Journal</h1>
        <p className="text-sm text-muted-foreground">
          Journal ledger as plain-text double-entry entries. All outputs are queries over these entires. Click an entry to view, unpost,
          or edit it.
        </p>
      </div>
      <JournalView />
    </div>
  )
}
