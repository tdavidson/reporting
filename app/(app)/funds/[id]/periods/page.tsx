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
        description="Allocate income and expenses to each partner and close the period"
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <PeriodsView />
      </FundSubpageChrome>
    </div>
  )
}
