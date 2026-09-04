import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireMancoAccess } from '../guard'
import { resolveMancoParam } from './resolve'
import { MancoDetailView } from './manco-detail-view'

export const metadata: Metadata = { title: 'Management company' }

/**
 * The management company's lead page — the manco answer to /funds/[id].
 *
 * The fund detail page shows TVPI, DPI, NAV, the schedule of investments and the growth charts.
 * None of those exist here, which is the reason this page exists at all rather than the manco
 * being one more row on the fund overview. What a firm asks about its own operating entity is:
 * how much cash is there, what came in and went out each quarter, where the money goes, and what
 * do the funds owe us. Those four, in that order.
 *
 * Gated on `management_company` alone (not the ledger conjunction) because everything on it comes
 * from /api/manco/*, which is gated the same way. The deeper ledger pages linked from here need
 * fund accounting as well — see ../guard.ts.
 */
export default async function MancoDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const { fundId } = await requireMancoAccess()
  const { vehicle, vehicleId, active } = await resolveMancoParam(fundId, params.id)

  return (
    <div className="pt-4 md:pt-8 pb-8 w-full px-4 md:pl-8 md:pr-4">
      <Link
        href="/manco"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-3.5 w-3.5" />All entities
      </Link>
      <MancoDetailView vehicle={vehicle} vehicleId={vehicleId} active={active} />
    </div>
  )
}
