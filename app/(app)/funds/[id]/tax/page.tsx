import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { resolveVehicleParam } from '../resolve'
import { FundSubpageChrome } from '@/components/fund-subpage-chrome'
import { TaxView } from '../../tax/view'

export const metadata: Metadata = { title: 'Tax' }

/**
 * The year's tax work for a vehicle. Gated on the accounting domain AND the tax_reporting
 * feature — the section guard checks the domain alone, and this page is the one that must not
 * render when the fund has tax reporting switched off: every route behind it is gated on the
 * feature, and a page of 403s is worse than a redirect.
 */
export default async function TaxPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')
  const page = await resolvePageAccess(user.id)
  if (!page || !canViewPage(page, 'accounting', 'tax_reporting')) redirect('/dashboard')

  const { vehicle, vehicleId } = await resolveVehicleParam(page.fundId, params.id)
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
