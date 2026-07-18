import type { Metadata } from 'next'
import { requireAccountingAccess } from '../../guard'
import { resolveVehicleParam } from '../resolve'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { CapitalAccountsView } from '../../capital-accounts/view'

export const metadata: Metadata = { title: 'Capital accounts' }

export default async function CapitalAccountsPage({ params }: { params: { id: string } }) {
  const { fundId } = await requireAccountingAccess()
  const { vehicle, vehicleId } = await resolveVehicleParam(fundId, params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundSubpageChrome
        title="Capital accounts"
        description="Limited Partner roll-forward derived from the ledger or LP position tracking."
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <CapitalAccountsView />
      </FundSubpageChrome>
    </div>
  )
}
