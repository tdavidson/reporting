import type { Metadata } from 'next'
import { requireVehicleAccess } from '../../guard'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { MigrateView } from '../../migrate/view'

export const metadata: Metadata = { title: 'Migrate from QuickBooks' }

export default async function MigratePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { vehicle, vehicleId } = await requireVehicleAccess(params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundSubpageChrome
        title="Migrate from QuickBooks"
        description="Import the general ledger, map the accounts, and tie every period out to QuickBooks"
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <MigrateView />
      </FundSubpageChrome>
    </div>
  )
}
