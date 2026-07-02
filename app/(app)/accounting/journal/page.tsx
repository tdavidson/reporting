import type { Metadata } from 'next'
import { ScrollText } from 'lucide-react'
import { requireAccountingAdmin } from '../guard'
import { AccountingPlaceholder } from '../placeholder'

export const metadata: Metadata = { title: 'Journal' }

export default async function JournalPage() {
  await requireAccountingAdmin()
  return (
    <AccountingPlaceholder
      title="Journal"
      icon={ScrollText}
      intro="Double-entry journal entries and postings — the book of record. Every entry balances (debits equal credits) and capital accounts, NAV, and the statements are queries over these postings."
    >
      No journal entries yet. Entries will appear here as opening balances, capital calls,
      distributions, fees, expenses, and valuations are booked.
    </AccountingPlaceholder>
  )
}
