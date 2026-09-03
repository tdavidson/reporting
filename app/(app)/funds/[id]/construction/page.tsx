import type { Metadata } from 'next'
import { requireAccountingAccess } from '../../guard'
import { resolveVehicleParam } from '../resolve'
import { ConstructionView } from '../../construction/view'

export const metadata: Metadata = { title: 'Portfolio construction' }

/**
 * Portfolio construction — the forward-looking half of a fund's page.
 *
 * Everything else under /funds reports what happened. This one plans what happens next: how much
 * investable capital is left after fees and expenses, how many more deals fit, and what exit the
 * portfolio has to reach. The derived actuals come from the commitments, the ledger and the
 * portfolio tracker; the assumptions layered on top of them are the GP's, stored per vehicle.
 *
 * NOT the ledger forecast (plans/plan-forecast.md), which compiles hypotheticals into journal
 * postings. Nothing here touches a journal.
 */
export default async function ConstructionPage(props: { params: Promise<{ id: string }> }) {
 const params = await props.params;
 const { fundId } = await requireAccountingAccess()
 const { vehicle, vehicleId } = await resolveVehicleParam(fundId, params.id)
 return <ConstructionView vehicle={vehicle} vehicleId={vehicleId} />
}
