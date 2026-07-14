import type { Metadata } from 'next'
import Link from 'next/link'
import { ACCOUNTING_SECTIONS } from '@/lib/accounting/nav'
import { requireAccountingAccess } from './guard'
import { AccountingSetup } from './setup'
import { FundOverview } from './fund-overview'

export const metadata: Metadata = { title: 'Funds' }

/**
 * The fund overview — the landing page for the whole accounting section.
 *
 * It used to be a hub of nothing but setup prompts and links to the subpages. The numbers a
 * GP actually opens this section to see (committed, called, distributed, NAV, TVPI, DPI, IRR
 * per vehicle) lived on a separate Funds page under Portfolio, where they were TYPED IN and
 * where carry was estimated with a heuristic.
 *
 * Those numbers are derivable from the books, exactly, so they lead here and the subpages
 * become what you click into. See lib/accounting/fund-economics.ts for why "net to LP" is now
 * exact rather than approximated.
 */
export default async function AccountingPage() {
  await requireAccountingAccess()

  return (
    <div className="px-4 md:pl-8 md:pr-4 pt-3 pb-8 w-full">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Funds</h1>
        <p className="text-sm text-muted-foreground">
          Performance per vehicle, derived from the ledger — and the capital accounts, schedule of investments
          and financial statements behind it.
        </p>
      </div>

      {/* Only shows itself when the books aren't set up yet. */}
      <AccountingSetup />

      <div className="mb-8">
        <FundOverview />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {ACCOUNTING_SECTIONS.map(({ href, label, icon: Icon, desc }) => (
          <Link
            key={href}
            href={href}
            className="border rounded-lg p-4 hover:bg-accent transition-colors flex gap-3"
          >
            <Icon className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
