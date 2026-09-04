import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireAccountingAccess, requireVehicleAccess } from '../guard'
import { FUND_SUBPAGE_SLUGS } from '@/components/fund-subpages'
import { sectionForSlug } from '@/lib/accounting/nav'
import { isManagementCompany } from '@/lib/vehicle-kinds'
import { AccountingPageHeader, AccountingBody } from '@/components/accounting-chrome'
import { FirmVehiclesTable } from '@/components/accounting/firm-vehicles'
import { FundDetailView } from './fund-detail-view'
import { MancoDetailView } from './manco-detail-view'

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await props.params
  const section = FUND_SUBPAGE_SLUGS.has(id) ? sectionForSlug(id) : null
  return { title: section?.label ?? 'Entity' }
}

/**
 * Two pages share this route, because the URL segment after /funds/ is either an entity or a
 * section, and which one decides what you get:
 *
 *   /funds/<entity id>  — the entity's LEAD page.
 *   /funds/<section>    — the FIRM-WIDE landing for that section: every entity, one row each,
 *                         linking to /funds/<id>/<section>.
 *
 * The second is what the sidebar's Entities subnav points at whenever the URL is not already
 * inside an entity. It used to point at whichever vehicle the browser last had in context — the
 * firm-wide page is the honest default: it asks which entity you mean instead of guessing.
 *
 * The lead page follows the entity's KIND, because this is the one page where a management
 * company genuinely differs. Every other page they share is the same double-entry ledger and so
 * is literally the same page; but a manco has no TVPI, no NAV, no schedule of investments and no
 * partners, so a fund's lead page would be a screen of dashes. What a firm asks about its own
 * operating entity is how much cash there is, what came in and went out each quarter, where the
 * money goes, and what the funds owe it.
 *
 * `[id]` is the vehicle's stable `fund_vehicles.id` (a UUID), the same way companies and LPs are
 * addressed — routing on the id survives a rename and sidesteps names with slashes. The gate
 * resolves it to the name and hands the client both, because the accounting data still keys on
 * the portfolio_group string while the switcher/sidebar route on the id. A legacy vehicle with no
 * registry row is addressed by its name directly, so an un-migrated fund still works.
 */
export default async function EntityPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  if (FUND_SUBPAGE_SLUGS.has(params.id)) return <FirmSectionPage slug={params.id} />

  const { vehicle, vehicleId, kind, active } = await requireVehicleAccess(params.id)

  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <Link href="/funds" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />All entities
      </Link>
      {isManagementCompany(kind) && vehicleId
        ? <MancoDetailView vehicle={vehicle} vehicleId={vehicleId} active={active} />
        : <FundDetailView vehicle={vehicle} vehicleId={vehicleId} />}
    </div>
  )
}

/**
 * The firm-wide landing for one section. The table is the same for every section — the state of
 * each entity's books is what you want to know whichever page you are heading for — and only the
 * row's link changes. Admin is also where an entity is added, so that page carries the button.
 */
async function FirmSectionPage({ slug }: { slug: string }) {
  await requireAccountingAccess()

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
