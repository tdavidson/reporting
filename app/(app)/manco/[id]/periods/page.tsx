import type { Metadata } from 'next'
import { requireMancoLedgerAccess } from '../../guard'
import { resolveMancoParam } from '../resolve'
import { MancoSubpageChrome } from '../subpage-chrome'
import { PeriodsView } from '../../../funds/periods/view'

export const metadata: Metadata = { title: 'Period close' }

/**
 * The management company's period close — the SHARED accounting view, scoped to this entity.
 *
 * A manco keeps double-entry books like any other vehicle, so this reuses the view the funds use
 * rather than growing a second implementation of the same ledger screen. What differs is the gate:
 * `requireMancoLedgerAccess` needs the `management_company` grant AND `accounting`, because the
 * view calls /api/accounting/* and the middleware gates those on the latter. See ../../guard.ts.
 */
export default async function MancoPeriodsPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const { fundId } = await requireMancoLedgerAccess()
  const { vehicle, vehicleId } = await resolveMancoParam(fundId, params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full px-4 md:pl-8 md:pr-4">
      <MancoSubpageChrome
        title="Period close"
        description="Close a period: roll the operating result into members’ capital and lock the books."
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <PeriodsView />
      </MancoSubpageChrome>
    </div>
  )
}
