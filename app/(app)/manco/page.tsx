import type { Metadata } from 'next'
import { requireMancoAccess } from './guard'
import { AccountingPageHeader, AccountingBody } from '@/components/accounting-chrome'
import { FirmVehiclesTable } from '@/components/accounting/firm-vehicles'

export const metadata: Metadata = { title: 'Management' }

/**
 * The Management landing: every entity the firm keeps books for — funds, SPVs, GP entities,
 * individuals and the management company — with the state of each one's books, and ONE button to
 * add another, whatever its kind.
 *
 * It used to be a list of management companies alone, with its own Add button, while funds were
 * added from the Start page and the investments page and the firm overview lived at a third URL.
 * Three registries for one fund_vehicles table. This is the one place: the row for a management
 * company leads to /manco/<id>, the row for anything else to /funds/<id>, and a manco whose chart
 * is not seeded yet offers "Set up books" where its link would be.
 *
 * Gated on `management_company`, as the section always was. The table reads the books through an
 * `accounting` route and falls back to the management companies alone for a caller without that
 * grant — the manco-only bookkeeper still sees their entities and can set them up.
 */
export default async function MancoPage() {
  await requireMancoAccess()

  return (
    <div className="pt-4 md:pt-8 pb-8 w-full px-4 md:pl-8 md:pr-4">
      <AccountingPageHeader title="Management">
        Every entity the firm keeps books for, and the state of each one&rsquo;s books. Add a fund,
        SPV, GP entity, individual or management company here.
      </AccountingPageHeader>

      <AccountingBody>
        <FirmVehiclesTable showAdd />
      </AccountingBody>
    </div>
  )
}
