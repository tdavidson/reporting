'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { FundScopeSync } from '@/components/fund-subpage-chrome'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AccountingBody } from '@/components/accounting-chrome'

/**
 * The chrome for a management company's ledger subpage — the manco twin of `FundSubpageChrome`.
 *
 * It exists for one difference, and it matters: the fund version renders `<FundSwitcher />`, which
 * lists the fund's INVESTMENT vehicles. On a manco page that control offers to switch you to a
 * fund — and since the shared views read the vehicle from context rather than the URL, picking one
 * would leave you on /manco/<id>/journal looking at a fund's journal. So there is no switcher here;
 * the way back is the way you came, and it says where it goes.
 *
 * `FundScopeSync` is reused as-is. It pins the section's vehicle context to the URL, which is what
 * makes the shared views (and the Analyst) read THIS entity's books.
 */
export function MancoSubpageChrome({
  title, description, vehicle, vehicleId, children,
}: {
  title: string
  description?: string
  vehicle: string
  vehicleId: string
  children: React.ReactNode
}) {
  return (
    <>
      <FundScopeSync vehicle={vehicle} vehicleId={vehicleId} />
      <Link
        href={`/manco/${vehicleId}`}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-3.5 w-3.5" />{vehicle}
      </Link>
      <div className="flex items-end justify-between gap-3 mb-6">
        <div className="space-y-1 min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <AnalystToggleButton />
        </div>
      </div>
      <AccountingBody>{children}</AccountingBody>
    </>
  )
}
