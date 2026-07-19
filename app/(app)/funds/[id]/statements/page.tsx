import type { Metadata } from 'next'
import { requireAccountingAccess } from '../../guard'
import { resolveVehicleParam } from '../resolve'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { StatementsView } from '../../statements/view'

export const metadata: Metadata = { title: 'Financial statements' }

export default async function StatementsPage({ params }: { params: { id: string } }) {
  const { fundId } = await requireAccountingAccess()
  const { vehicle, vehicleId } = await resolveVehicleParam(fundId, params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundSubpageChrome
        title="Financial statements"
        description="The four ASC 946 statements — assets & partners’ capital, operations, cash flows, and changes in partners’ capital — derived from the ledger."
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <StatementsView />
      </FundSubpageChrome>
    </div>
  )
}
