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
        description="Take over at a cutover date the way a fund admin does: enter each LP’s capital balance from their most recent statement. This books one posted opening entry — no need to reconstruct history from inception."
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
