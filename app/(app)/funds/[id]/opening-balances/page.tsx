import type { Metadata } from 'next'
import { requireVehicleAccess } from '../../guard'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { OpeningBalancesView } from '../../opening-balances/view'
import { SnapshotCutover } from '../../opening-balances/snapshot-cutover'

export const metadata: Metadata = { title: 'Opening balances' }

export default async function OpeningBalancesPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { vehicle, vehicleId } = await requireVehicleAccess(params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundSubpageChrome
        title="Opening balances"
        description="Take over at a cutover date: enter each LP’s capital balance from their latest statement. Books one opening entry — no history to reconstruct."
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        {/* The bulk route in: copy an existing LP snapshot into every vehicle at once, rather
            than typing each LP's balance by hand below. Fund-wide, so it sits above the
            vehicle-scoped form. */}
        <div className="mb-8">
          <SnapshotCutover />
        </div>
        <OpeningBalancesView />
      </FundSubpageChrome>
    </div>
  )
}
