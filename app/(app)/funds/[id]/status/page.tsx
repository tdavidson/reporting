import type { Metadata } from 'next'
import { requireVehicleAccess } from '../../guard'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { StatusView } from '../../status/view'

export const metadata: Metadata = { title: 'Admin' }

export default async function StatusPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { vehicle, vehicleId } = await requireVehicleAccess(params.id)
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
