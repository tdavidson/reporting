import type { Metadata } from 'next'
import { requireAccountingAccess } from '../../guard'
import { resolveVehicleParam } from '../resolve'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { JournalView } from '../../journal/view'

export const metadata: Metadata = { title: 'Journal' }

export default async function JournalPage({ params }: { params: { id: string } }) {
  const { fundId } = await requireAccountingAccess()
  const { vehicle, vehicleId } = await resolveVehicleParam(fundId, params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundSubpageChrome
        title="Journal"
        description="Journal ledger as plain-text double-entry entries. All outputs are queries over these entries. Click an entry to view, unpost, or edit it."
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <JournalView />
      </FundSubpageChrome>
    </div>
  )
}
