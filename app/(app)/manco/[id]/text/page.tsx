import type { Metadata } from 'next'
import { requireMancoLedgerAccess } from '../../guard'
import { resolveMancoParam } from '../resolve'
import { MancoSubpageChrome } from '../subpage-chrome'
import { TextLedgerView } from '../../../funds/text/view'

export const metadata: Metadata = { title: 'Plain text' }

/**
 * The management company's plain-text authoring page — the SHARED view, scoped to this entity.
 * Same gate as the other manco ledger pages; see ../../guard.ts.
 */
export default async function MancoTextLedgerPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const { fundId } = await requireMancoLedgerAccess()
  const { vehicle, vehicleId } = await resolveMancoParam(fundId, params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full px-4 md:pl-8 md:pr-4">
      <MancoSubpageChrome
        title="Plain text"
        description="Author entries in the double-entry text format and post them in one go."
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <TextLedgerView />
      </MancoSubpageChrome>
    </div>
  )
}
