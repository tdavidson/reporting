import type { Metadata } from 'next'
import { requireAccountingAccess } from '../guard'
import { BankView } from './view'

export const metadata: Metadata = { title: 'Bank transactions' }

export default async function BankPage() {
  await requireAccountingAccess()
  return (
    <div className="px-4 md:pl-8 md:pr-4 pt-3 pb-8 w-full">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Bank transactions</h1>
        <p className="text-sm text-muted-foreground">
          Import a transaction feed from any source, review the drafted entries, and reconcile the
          ledger&rsquo;s cash against the bank.
        </p>
      </div>
      <BankView />
    </div>
  )
}
