import type { Metadata } from 'next'
import { requireAccountingAccess } from '../../guard'
import { resolveVehicleParam } from '../resolve'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { StatusView } from '../../status/view'

export const metadata: Metadata = { title: 'Admin' }

export default async function StatusPage({ params }: { params: { id: string } }) {
  const { fundId } = await requireAccountingAccess()
  const { vehicle, vehicleId } = await resolveVehicleParam(fundId, params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundSubpageChrome
        title="Admin"
        description="Current status and open issues"
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <StatusView />
      </FundSubpageChrome>
    </div>
  )
}
