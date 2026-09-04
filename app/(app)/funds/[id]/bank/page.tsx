import type { Metadata } from 'next'
import { requireVehicleAccess } from '../../guard'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { BankView } from '../../bank/view'

export const metadata: Metadata = { title: 'Bank transactions' }

export default async function BankPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { vehicle, vehicleId } = await requireVehicleAccess(params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundSubpageChrome
        title="Bank transactions"
        description="Import bank transactions and post to the journal"
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <BankView />
      </FundSubpageChrome>
    </div>
  )
}
