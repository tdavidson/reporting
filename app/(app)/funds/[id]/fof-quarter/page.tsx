import type { Metadata } from 'next'
import { requireVehicleAccess } from '../../guard'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { FofQuarterView } from '../../fof-quarter/view'

export const metadata: Metadata = { title: 'Quarterly close — underlying funds' }

export default async function FofQuarterPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { vehicle, vehicleId } = await requireVehicleAccess(params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundSubpageChrome
        title="Quarterly close — underlying funds"
        description="Paste the quarter's underlying-fund figures, confirm the notices, and book the period-end marks"
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <FofQuarterView />
      </FundSubpageChrome>
    </div>
  )
}
