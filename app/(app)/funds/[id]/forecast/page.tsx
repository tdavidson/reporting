import type { Metadata } from 'next'
import { requireAccountingAccess } from '../../guard'
import { resolveVehicleParam } from '../resolve'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { ForecastView } from '../../forecast/view'

export const metadata: Metadata = { title: 'Forecast' }

export default async function ForecastPage({ params }: { params: { id: string } }) {
  const { fundId } = await requireAccountingAccess()
  const { vehicle, vehicleId } = await resolveVehicleParam(fundId, params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundSubpageChrome
        title="Forecast"
        description="Monte Carlo over the existing book plus forecasted new investments"
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <ForecastView />
      </FundSubpageChrome>
    </div>
  )
}
