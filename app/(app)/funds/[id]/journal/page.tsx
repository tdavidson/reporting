import type { Metadata } from 'next'
import { requireVehicleAccess } from '../../guard'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { JournalPageView } from '../../journal/page-view'

export const metadata: Metadata = { title: 'Journal' }

export default async function JournalPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { vehicle, vehicleId } = await requireVehicleAccess(params.id)
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
