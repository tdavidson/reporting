import type { Metadata } from 'next'
import { requireAccountingAccess } from './guard'
import { FundOverview } from './fund-overview'
import { MancoOverview } from './manco-overview'
import { AccountingPageHeader, AccountingBody } from '@/components/accounting-chrome'

export const metadata: Metadata = { title: 'Entities' }

/**
 * The entity overview — the landing page for the whole accounting section.
 *
 * Performance per vehicle, derived from the ledger. The subpages (capital accounts,
 * statements, journal, …) are reached from the sidebar subnav, so this page does NOT repeat
 * them as a grid of link cards — that was duplicative — and the per-vehicle rows don't link
 * either. See lib/accounting/fund-economics.ts for why "net to LP" is exact here rather than
 * estimated.
 *
 * FundOverview owns its own empty state: with no vehicle carrying any capital, it explains how
 * to onboard one rather than showing a blank table. MancoOverview owns the opposite — it renders
 * nothing rather than an empty state, because a firm with no management company should not be
 * told about one on the page it sees most. (Per-vehicle setup lives on the Admin page,
 * /funds/<id>/status; the state of every entity's books is the firm-wide Admin page,
 * /funds/status, which every other section's firm-wide landing shares.)
 */
export default async function AccountingPage() {
  await requireAccountingAccess()

  return (
    // The overview owns its own layout, in the /dashboard shape: the header sits ABOVE the body,
    // so the title goes all the way to the top with the toggle inline at its right, and the Analyst
    // panel opens below it rather than level with it. AccountingChrome steps aside on this route.
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <AccountingPageHeader title="Entities">
        Performance per investment vehicle, derived from fund accounting or LP capital accounts,
        and the firm&rsquo;s own operating entities below it.
      </AccountingPageHeader>

      <AccountingBody>
        {/* Two tables, because the columns are two different questions. The investment vehicles
            are measured on what they returned; a management company has no NAV or multiple to
            report and is measured on cash, what it earns against what it spends, and runway.
            MancoOverview renders nothing at all where there is no management company. */}
        <div className="space-y-8">
          <FundOverview />
          <MancoOverview />
        </div>
      </AccountingBody>
    </div>
  )
}
