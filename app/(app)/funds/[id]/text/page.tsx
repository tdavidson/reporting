import type { Metadata } from 'next'
import { requireAccountingAccess } from '../../guard'
import { resolveVehicleParam } from '../resolve'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { TextLedgerView } from '../../text/view'

export const metadata: Metadata = { title: 'Plain text' }

export default async function TextLedgerPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const { fundId } = await requireAccountingAccess()
  const { vehicle, vehicleId } = await resolveVehicleParam(fundId, params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundSubpageChrome
        title="Plain text"
        description="Author entries in the double-entry text format and post them in one go. See ACCOUNTING.md for the format."
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <TextLedgerView />
      </FundSubpageChrome>
    </div>
  )
}
