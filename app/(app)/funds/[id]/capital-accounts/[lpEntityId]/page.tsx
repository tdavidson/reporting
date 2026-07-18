import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireAccountingAccess } from '../../../guard'
import { resolveVehicleParam } from '../../resolve'
import { FundScopeSync } from '@/components/fund-subpage-chrome'
import { FundSwitcher } from '@/components/accounting-vehicle'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AccountingBody } from '@/components/accounting-chrome'
import { LpStatementView } from '../../../capital-accounts/[lpEntityId]/view'

export const metadata: Metadata = { title: 'LP capital statement' }

export default async function LpStatementPage({
  params, searchParams,
}: {
  params: { id: string; lpEntityId: string }
  searchParams: { from?: string }
}) {
  const { fundId } = await requireAccountingAccess()
  const { vehicle, vehicleId } = await resolveVehicleParam(fundId, params.id)
  // Return to wherever the LP was opened from: the LP capital-accounts page marks its links
  // with `?from=lps`; everything else (the Funds capital-accounts table) uses the default.
  const fromLps = searchParams?.from === 'lps'
  const backHref = fromLps ? '/lps/capital' : `/funds/${params.id}/capital-accounts`
  const backLabel = fromLps ? 'LP capital accounts' : 'Capital accounts'
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundScopeSync vehicle={vehicle} vehicleId={vehicleId} />
      <Link href={backHref} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />{backLabel}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">LP capital statement</h1>
        <div className="flex items-center gap-2">
          <FundSwitcher />
          <AnalystToggleButton />
        </div>
      </div>
      <AccountingBody>
        <LpStatementView lpEntityId={params.lpEntityId} />
      </AccountingBody>
    </div>
  )
}
