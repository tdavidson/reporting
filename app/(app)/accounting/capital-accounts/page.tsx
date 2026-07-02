import type { Metadata } from 'next'
import { Users } from 'lucide-react'
import { requireAccountingAdmin } from '../guard'
import { AccountingPlaceholder } from '../placeholder'

export const metadata: Metadata = { title: 'Capital accounts' }

export default async function CapitalAccountsPage() {
  await requireAccountingAdmin()
  return (
    <AccountingPlaceholder
      title="Capital accounts"
      icon={Users}
      intro="Per-LP capital-account roll-forward, derived from the ledger: beginning capital → contributions → distributions → fees → allocated gains → ending capital."
    >
      No capital accounts yet. Import opening balances and post a period of activity to see each
      LP&rsquo;s roll-forward here.
    </AccountingPlaceholder>
  )
}
