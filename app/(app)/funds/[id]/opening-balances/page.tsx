import type { Metadata } from 'next'
import { requireAccountingAccess } from '../../guard'
import { resolveVehicleParam } from '../resolve'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { OpeningBalancesView } from '../../opening-balances/view'
import { SnapshotCutover } from '../../opening-balances/snapshot-cutover'

export const metadata: Metadata = { title: 'Opening balances' }

export default async function OpeningBalancesPage({ params }: { params: { id: string } }) {
  const { fundId } = await requireAccountingAccess()
  const { vehicle, vehicleId } = await resolveVehicleParam(fundId, params.id)
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
