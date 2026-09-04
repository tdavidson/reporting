import type { Metadata } from 'next'
import { requireVehicleAccess } from '../../guard'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { TaxView } from '../../tax/view'

export const metadata: Metadata = { title: 'Tax' }

/**
 * The year's tax work for an entity. Gated on the accounting domain AND the tax_reporting
 * feature — the entity gate takes the feature for exactly this reason: every route behind this
 * page is gated on it, and a page of 403s is worse than a redirect. The entity's own grant is
 * checked there too, so a management company still needs `management_company`.
 */
export default async function TaxPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const { vehicle, vehicleId } = await requireVehicleAccess(params.id, { feature: 'tax_reporting' })
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundSubpageChrome
        title="Tax"
        description="The year's book-to-tax adjustments, adjusting entries, K-1 package, partner tax forms, and the tax package for the preparer."
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <TaxView />
      </FundSubpageChrome>
    </div>
  )
}
