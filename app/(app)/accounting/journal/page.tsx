import type { Metadata } from 'next'
import { requireAccountingAdmin } from '../guard'
import { JournalView } from './view'

export const metadata: Metadata = { title: 'Journal' }

export default async function JournalPage() {
  await requireAccountingAdmin()
  return (
    <div className="px-4 md:pl-8 md:pr-4 pt-3 pb-8 w-full">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Journal</h1>
        <p className="text-sm text-muted-foreground">
          The book of record, as plain-text double-entry. Every entry balances; capital accounts,
          NAV, and the statements are queries over these postings. Click an entry to view, unpost,
          or edit it.
        </p>
      </div>
      <JournalView />
    </div>
  )
}
