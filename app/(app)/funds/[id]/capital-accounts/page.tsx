import type { Metadata } from 'next'
import { requireVehicleAccess } from '../../guard'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { CapitalAccountsView } from '../../capital-accounts/view'

export const metadata: Metadata = { title: 'Capital accounts' }

export default async function CapitalAccountsPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { vehicle, vehicleId } = await requireVehicleAccess(params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundSubpageChrome
        title="Capital accounts"
        description="Limited partner roll-forward per period"
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <CapitalAccountsView />
      </FundSubpageChrome>
    </div>
  )
}
