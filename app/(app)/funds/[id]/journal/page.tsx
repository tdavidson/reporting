import type { Metadata } from 'next'
import { requireAccountingAccess } from '../../guard'
import { resolveVehicleParam } from '../resolve'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { JournalPageView } from '../../journal/page-view'

export const metadata: Metadata = { title: 'Journal' }

export default async function JournalPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { fundId } = await requireAccountingAccess()
  const { vehicle, vehicleId } = await resolveVehicleParam(fundId, params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundSubpageChrome
        title="Journal"
        description="Every entry, to view, unpost or edit — or author entries as plain text and post them in one go."
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <JournalPageView />
      </FundSubpageChrome>
    </div>
  )
}
