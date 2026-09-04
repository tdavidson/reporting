import type { Metadata } from 'next'
import { requireAccountingAccess } from './guard'
import { FundOverview } from './fund-overview'
import { AccountingPageHeader, AccountingBody } from '@/components/accounting-chrome'

export const metadata: Metadata = { title: 'Funds' }

/**
 * The fund overview — the landing page for the whole accounting section.
 *
 * Performance per vehicle, derived from the ledger. The subpages (capital accounts,
 * statements, journal, …) are reached from the sidebar subnav, so this page does NOT repeat
 * them as a grid of link cards — that was duplicative — and the per-vehicle rows don't link
 * either. See lib/accounting/fund-economics.ts for why "net to LP" is exact here rather than
 * estimated.
 *
 * FundOverview owns its own empty state: with no vehicle carrying any capital, it explains how
 * to onboard one rather than showing a blank table. (Per-vehicle setup lives on the Admin
 * page, /funds/<id>/status; the state of every entity's books is the firm-wide Admin page,
 * /funds/status, which every other section's firm-wide landing shares.)
 */
export default async function AccountingPage() {
  await requireAccountingAccess()

  return (
    // The overview owns its own layout, in the /dashboard shape: the header sits ABOVE the body,
    // so the title goes all the way to the top with the toggle inline at its right, and the Analyst
    // panel opens below it rather than level with it. AccountingChrome steps aside on this route.
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <AccountingPageHeader title="Funds">
        Performance per vehicle, derived from fund accounting or LP capital accounts.
      </AccountingPageHeader>

      <AccountingBody>
        <FundOverview />
      </AccountingBody>
    </div>
  )
}
