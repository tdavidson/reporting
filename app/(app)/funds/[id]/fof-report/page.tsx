import type { Metadata } from 'next'
import { requireVehicleAccess } from '../../guard'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { FofReportView } from '../../fof-report/view'

export const metadata: Metadata = { title: 'Fund-of-funds report' }

export default async function FofReportPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { vehicle, vehicleId } = await requireVehicleAccess(params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundSubpageChrome
        title="Fund-of-funds report"
        description="Schedule of investments, commitments and liquidity, and underlying fund performance"
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <FofReportView />
      </FundSubpageChrome>
    </div>
  )
}
