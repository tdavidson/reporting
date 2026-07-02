import type { Metadata } from 'next'
import { FileText } from 'lucide-react'
import { requireAccountingAdmin } from '../guard'
import { AccountingPlaceholder } from '../placeholder'

export const metadata: Metadata = { title: 'Financial statements' }

export default async function StatementsPage() {
  await requireAccountingAdmin()
  return (
    <AccountingPlaceholder
      title="Financial statements"
      icon={FileText}
      intro="Balance sheet, income statement, statement of changes in partners' capital, and statement of cash flows — all derived from the trial balance."
    >
      Coming soon. These derive from the trial balance once the ledger is populated.
    </AccountingPlaceholder>
  )
}
