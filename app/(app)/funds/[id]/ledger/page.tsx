import type { Metadata } from 'next'
import { Suspense } from 'react'
import { requireVehicleAccess } from '../../guard'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { LedgerView } from '../../ledger/view'

export const metadata: Metadata = { title: 'General ledger' }

export default async function LedgerPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const { vehicle, vehicleId } = await requireVehicleAccess(params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundSubpageChrome
        title="General ledger"
        description="One account at a time: the balance carried in, every posting, and the running balance."
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        {/* The view reads ?account= and ?highlight= from the URL, which needs a boundary. */}
        <Suspense fallback={null}>
          <LedgerView />
        </Suspense>
      </FundSubpageChrome>
    </div>
  )
}
