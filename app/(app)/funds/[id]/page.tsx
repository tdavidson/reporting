import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireAccountingAccess } from '../guard'
import { FUND_SUBPAGE_SLUGS } from '@/components/accounting-vehicle'
import { resolveVehicleParam } from './resolve'
import { FundDetailView } from './fund-detail-view'

export const metadata: Metadata = { title: 'Fund' }

/**
 * The fund detail page — the LEAD page for a single vehicle.
 *
 * `/funds` is the whole-fund overview (every vehicle in one table); this is where a vehicle row
 * on it now leads. It carries the vehicle's key metrics (same box style as the overview and the
 * LP snapshot), the schedule-of-investments breakdown, and the growth / NAV-composition charts.
 * The operational admin — onboarding, the close, the health check, allocation settings — lives on
 * the fund's `status` subpage, reached from the sidebar (Funds → Admin).
 *
 * `[id]` is the vehicle's stable `fund_vehicles.id` (a UUID), the same way companies and LPs are
 * addressed — routing on the id survives a rename and sidesteps names with slashes. We resolve it
 * to the name here (via resolveVehicleParam) and hand the client both, because the accounting data
 * still keys on the portfolio_group string while the switcher/sidebar route on the id. A legacy
 * vehicle with no registry row is addressed by its name directly, so an un-migrated fund still
 * works. Every fund page owns its own header (fund switcher + Analyst) and wraps its body in
 * <AccountingBody>; there is no shared vehicle-selector bar — the URL pins the vehicle.
 */
export default async function FundDetailPage({ params }: { params: { id: string } }) {
  // An old bare subpage link (/funds/journal) now falls through to this dynamic route with
  // the slug in the id slot — bounce it to the overview rather than "vehicle not found".
  if (FUND_SUBPAGE_SLUGS.has(params.id)) redirect('/funds')

  const { fundId } = await requireAccountingAccess()
  const { vehicle, vehicleId } = await resolveVehicleParam(fundId, params.id)

  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <Link href="/funds" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />All funds
      </Link>
      <FundDetailView vehicle={vehicle} vehicleId={vehicleId} />
    </div>
  )
}
