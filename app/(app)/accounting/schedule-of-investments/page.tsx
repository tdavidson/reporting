import type { Metadata } from 'next'
import { Layers } from 'lucide-react'
import { requireAccountingAdmin } from '../guard'
import { AccountingPlaceholder } from '../placeholder'

export const metadata: Metadata = { title: 'Schedule of investments' }

export default async function ScheduleOfInvestmentsPage() {
  await requireAccountingAdmin()
  return (
    <AccountingPlaceholder
      title="Schedule of investments"
      icon={Layers}
      intro="The SOI: each portfolio investment with cost, fair value, and % of net assets — a derived output of the ledger and the existing investment/valuation records."
    >
      Coming soon. This will derive from investment cost, valuations, and the ledger&rsquo;s net assets.
    </AccountingPlaceholder>
  )
}
