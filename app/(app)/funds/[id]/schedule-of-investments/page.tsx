import type { Metadata } from 'next'
import { requireAccountingAccess } from '../../guard'
import { resolveVehicleParam } from '../resolve'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { ScheduleOfInvestmentsView } from '../../schedule-of-investments/view'

export const metadata: Metadata = { title: 'Schedule of investments' }

export default async function ScheduleOfInvestmentsPage({ params }: { params: { id: string } }) {
  const { fundId } = await requireAccountingAccess()
  const { vehicle, vehicleId } = await resolveVehicleParam(fundId, params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundSubpageChrome
        title="Schedule of investments"
        description="Each investment at cost and fair value, with its share of net assets — derived from the ledger (investment cost + unrealized appreciation)."
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <ScheduleOfInvestmentsView />
      </FundSubpageChrome>
    </div>
  )
}
