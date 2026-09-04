import type { Metadata } from 'next'
import { requireMancoLedgerAccess } from '../../guard'
import { resolveMancoParam } from '../resolve'
import { MancoSubpageChrome } from '../subpage-chrome'
import { JournalPageView } from '../../../funds/journal/page-view'

export const metadata: Metadata = { title: 'Journal' }

/**
 * The management company's journal — the SHARED accounting page (entries and the plain-text
 * editor as tabs), scoped to this entity.
 *
 * A manco keeps double-entry books like any other vehicle, so this reuses the page the funds use
 * rather than growing a second implementation of the same ledger screen. What differs is the gate:
 * `requireMancoLedgerAccess` needs the `management_company` grant AND `accounting`, because the
 * view calls /api/accounting/* and the middleware gates those on the latter. See ../../guard.ts.
 */
export default async function MancoJournalPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const { fundId } = await requireMancoLedgerAccess()
  const { vehicle, vehicleId } = await resolveMancoParam(fundId, params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full px-4 md:pl-8 md:pr-4">
      <MancoSubpageChrome
        title="Journal"
        description="Every entry, to view, unpost or edit — or author entries as plain text and post them in one go."
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <JournalPageView />
      </MancoSubpageChrome>
    </div>
  )
}
