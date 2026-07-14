import type { Metadata } from 'next'
import { requireAccountingAccess } from '../guard'
import { CapitalAccountsView } from './view'

export const metadata: Metadata = { title: 'Capital accounts' }

export default async function CapitalAccountsPage() {
  await requireAccountingAccess()
  return (
    <div className="px-4 md:pl-8 md:pr-4 pt-3 pb-8 w-full">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Capital accounts</h1>
        <p className="text-sm text-muted-foreground">
          Per-LP roll-forward derived from the ledger: beginning → contributions → distributions →
          fees → gains → ending.
        </p>
      </div>
      <CapitalAccountsView />
    </div>
  )
}
