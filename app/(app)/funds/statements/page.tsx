import type { Metadata } from 'next'
import { requireAccountingAccess } from '../guard'
import { StatementsView } from './view'

export const metadata: Metadata = { title: 'Financial statements' }

export default async function StatementsPage() {
  await requireAccountingAccess()
  return (
    <div className="px-4 md:pl-8 md:pr-4 pt-3 pb-8 w-full">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Financial statements</h1>
        <p className="text-sm text-muted-foreground">
          Statement of assets, liabilities and partners&rsquo; capital; statement of operations;
          statement of cash flows; and statement of changes in partners&rsquo; capital — all derived
          from the ledger. The balance sheet is a snapshot at the period end; the others cover the period.
        </p>
      </div>
      <StatementsView />
    </div>
  )
}
