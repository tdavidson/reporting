import type { Metadata } from 'next'
import { requireAccountingAccess } from '../../guard'
import { resolveVehicleParam } from '../resolve'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { PeriodsView } from '../../periods/view'

export const metadata: Metadata = { title: 'Period close' }

export default async function PeriodsPage({ params }: { params: { id: string } }) {
  const { fundId } = await requireAccountingAccess()
  const { vehicle, vehicleId } = await resolveVehicleParam(fundId, params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundSubpageChrome
        title="Period close"
        description="Closing a period allocates its income and expenses to each partner’s capital account, snapshots the ledger, and freezes the books for that date range. New postings dated inside it are blocked until you reopen."
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <PeriodsView />
      </FundSubpageChrome>
    </div>
  )
}
