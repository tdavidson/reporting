import type { Metadata } from 'next'
import { requireVehicleAccess } from '../../guard'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { ScheduleOfInvestmentsView } from '../../schedule-of-investments/view'

export const metadata: Metadata = { title: 'Schedule of investments' }

export default async function ScheduleOfInvestmentsPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { vehicle, vehicleId } = await requireVehicleAccess(params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundSubpageChrome
        title="Schedule of investments"
        description="Each investment at cost and fair value"
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <ScheduleOfInvestmentsView />
      </FundSubpageChrome>
    </div>
  )
}
