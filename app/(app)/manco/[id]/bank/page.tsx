import type { Metadata } from 'next'
import { requireMancoLedgerAccess } from '../../guard'
import { resolveMancoParam } from '../resolve'
import { MancoSubpageChrome } from '../subpage-chrome'
import { BankView } from '../../../funds/bank/view'

export const metadata: Metadata = { title: 'Bank transactions' }

/**
 * The management company's bank transactions — the SHARED accounting view, scoped to this entity.
 *
 * A manco keeps double-entry books like any other vehicle, so this reuses the view the funds use
 * rather than growing a second implementation of the same ledger screen. What differs is the gate:
 * `requireMancoLedgerAccess` needs the `management_company` grant AND `accounting`, because the
 * view calls /api/accounting/* and the middleware gates those on the latter. See ../../guard.ts.
 */
export default async function MancoBankPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const { fundId } = await requireMancoLedgerAccess()
  const { vehicle, vehicleId } = await resolveMancoParam(fundId, params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full px-4 md:pl-8 md:pr-4">
      <MancoSubpageChrome
        title="Bank transactions"
        description="Import the management company’s bank feed and post to the journal."
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <BankView />
      </MancoSubpageChrome>
    </div>
  )
}
