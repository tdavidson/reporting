import type { Metadata } from 'next'
import { requireAccountingAdmin } from '../guard'
import { AssistantView } from './view'

export const metadata: Metadata = { title: 'Accounting assistant' }

export default async function AccountingAssistantPage() {
  await requireAccountingAdmin()
  return (
    <div className="px-4 md:pl-8 md:pr-4 pt-3 pb-8 w-full">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Accounting assistant</h1>
        <p className="text-sm text-muted-foreground">
          Ask the AI to review your books or draft an entry. It reads this vehicle&apos;s chart,
          balances, and recent entries, and proposes journal entries or edits — which you apply as
          drafts to review and post. Nothing is posted automatically.
        </p>
      </div>
      <AssistantView />
    </div>
  )
}
