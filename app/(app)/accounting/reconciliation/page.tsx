import type { Metadata } from 'next'
import { GitCompareArrows } from 'lucide-react'
import { requireAccountingAdmin } from '../guard'
import { AccountingPlaceholder } from '../placeholder'

export const metadata: Metadata = { title: 'Reconciliation' }

export default async function ReconciliationPage() {
  await requireAccountingAdmin()
  return (
    <AccountingPlaceholder
      title="Reconciliation"
      icon={GitCompareArrows}
      intro="Shadow-reconcile: the ledger's capital accounts side-by-side against the existing fund admin's statement, per LP, with per-line deltas. Ties out to the penny or the delta is explained."
    >
      No reconciliation yet. Once a period is posted, this page compares the ledger&rsquo;s ending
      capital per LP against the admin statement and highlights any differences.
    </AccountingPlaceholder>
  )
}
