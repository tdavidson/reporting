import type { Metadata } from 'next'
import { requireAccountingAccess } from '../../guard'
import { resolveVehicleParam } from '../resolve'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { BankView } from '../../bank/view'

export const metadata: Metadata = { title: 'Bank transactions' }

export default async function BankPage({ params }: { params: { id: string } }) {
  const { fundId } = await requireAccountingAccess()
  const { vehicle, vehicleId } = await resolveVehicleParam(fundId, params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundSubpageChrome
        title="Bank transactions"
        description="Import a transaction feed from any source, review the drafted entries, and reconcile the ledger’s cash against the bank."
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <BankView />
      </FundSubpageChrome>
    </div>
  )
}
