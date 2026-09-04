import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireAccountingAccess } from '../guard'
import { FUND_SUBPAGE_SLUGS } from '@/components/fund-subpages'
import { sectionForSlug } from '@/lib/accounting/nav'
import { AccountingPageHeader, AccountingBody } from '@/components/accounting-chrome'
import { FirmVehiclesTable } from '@/components/accounting/firm-vehicles'
import { resolveVehicleParam } from './resolve'
import { FundDetailView } from './fund-detail-view'

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await props.params
  const section = FUND_SUBPAGE_SLUGS.has(id) ? sectionForSlug(id) : null
  return { title: section?.label ?? 'Fund' }
}

/**
 * Two pages share this route, because the URL segment after /funds/ is either a vehicle or a
 * section, and which one decides what you get:
 *
 *   /funds/<vehicle id>  — the fund detail page, the LEAD page for a single vehicle.
 *   /funds/<section>     — the FIRM-WIDE landing for that section: every entity, one row each,
 *                          linking to /funds/<id>/<section> (or /manco/<id>/<section>).
 *
 * The second is what the sidebar's Funds subnav points at whenever the URL is not already inside
 * a fund. It used to point at whichever vehicle the browser last had in context — which, after a
 * visit to a management company, was the manco, so "Funds → Bank" opened the manco's bank page.
 * The firm-wide page is the honest default: it asks which vehicle you mean instead of guessing.
 *
 * `[id]` is the vehicle's stable `fund_vehicles.id` (a UUID), the same way companies and LPs are
 * addressed — routing on the id survives a rename and sidesteps names with slashes. We resolve it
 * to the name here (via resolveVehicleParam) and hand the client both, because the accounting data
 * still keys on the portfolio_group string while the switcher/sidebar route on the id. A legacy
 * vehicle with no registry row is addressed by its name directly, so an un-migrated fund still
 * works. Every fund page owns its own header (fund switcher + Analyst) and wraps its body in
 * <AccountingBody>; there is no shared vehicle-selector bar — the URL pins the vehicle.
 */
export default async function FundDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { fundId } = await requireAccountingAccess()

  if (FUND_SUBPAGE_SLUGS.has(params.id)) return <FirmSectionPage slug={params.id} />

  const { vehicle, vehicleId } = await resolveVehicleParam(fundId, params.id)

  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <Link href="/funds" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />All funds
      </Link>
      <FundDetailView vehicle={vehicle} vehicleId={vehicleId} />
    </div>
  )
}

/**
 * The firm-wide landing for one section. The table is the same for every section — the state of
 * each entity's books is what you want to know whichever page you are heading for — and only the
 * row's link changes. Admin is also where a vehicle is added, so that page carries the button.
 */
function FirmSectionPage({ slug }: { slug: string }) {
  // Two slugs are not pages of their own any more: plain-text authoring is a tab on the journal,
  // and LP capital events are one of the producers on the capital accounts page.
  if (slug === 'text') redirect('/funds/journal?tab=text')
  if (slug === 'lp-events') redirect('/funds/capital-accounts')

  const section = sectionForSlug(slug)
  if (!section) redirect('/funds')

  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <AccountingPageHeader title={section.label}>{section.desc}</AccountingPageHeader>
      <AccountingBody>
        <FirmVehiclesTable section={slug} showAdd={slug === 'status'} />
      </AccountingBody>
    </div>
  )
}
