import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireAccountingAccess } from '../guard'
import { AccountingBody } from '@/components/accounting-chrome'
import { FundDetailView } from './fund-detail-view'

export const metadata: Metadata = { title: 'Fund' }

/**
 * The fund detail page — the LEAD page for a single vehicle.
 *
 * `/funds` is the whole-fund overview (every vehicle in one table); this is where a vehicle row
 * on it now leads. It carries the vehicle's key metrics (same box style as the overview and the
 * LP snapshot), the schedule-of-investments breakdown, and the growth / NAV-composition charts.
 * The operational admin — onboarding, the close, the health check, allocation settings — stays on
 * `/funds/status`, which this page links to.
 *
 * `[id]` is the vehicle NAME (portfolio_group), URL-encoded — the whole Accounting section keys on
 * the name, not a surrogate id (see components/accounting-vehicle.tsx). Like `/funds`, this page
 * owns its own layout: AccountingChrome steps aside for it (isFundDetailPath), so there is no
 * vehicle-selector bar — the URL pins the vehicle.
 */
export default async function FundDetailPage({ params }: { params: { id: string } }) {
  await requireAccountingAccess()
  const vehicle = decodeURIComponent(params.id)

  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <Link href="/funds" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />All funds
      </Link>
      <AccountingBody>
        <FundDetailView vehicle={vehicle} />
      </AccountingBody>
    </div>
  )
}
