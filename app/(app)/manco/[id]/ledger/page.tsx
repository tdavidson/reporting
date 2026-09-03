import type { Metadata } from 'next'
import { Suspense } from 'react'
import { requireMancoLedgerAccess } from '../../guard'
import { resolveMancoParam } from '../resolve'
import { MancoSubpageChrome } from '../subpage-chrome'
import { LedgerView } from '../../../funds/ledger/view'

export const metadata: Metadata = { title: 'General ledger' }

/**
 * The management company's general ledger — the SHARED register view, scoped to this entity.
 *
 * Same gate as the other manco ledger pages: `requireMancoLedgerAccess` needs the
 * `management_company` grant AND `accounting`, because the view calls /api/accounting/* and the
 * middleware gates those on the latter. See ../../guard.ts.
 */
export default async function MancoLedgerPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const { fundId } = await requireMancoLedgerAccess()
  const { vehicle, vehicleId } = await resolveMancoParam(fundId, params.id)
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full px-4 md:pl-8 md:pr-4">
      <MancoSubpageChrome
        title="General ledger"
        description="One account at a time: the balance carried in, every posting, and the running balance."
        vehicle={vehicle}
        vehicleId={vehicleId}
      >
        <Suspense fallback={null}>
          <LedgerView />
        </Suspense>
      </MancoSubpageChrome>
    </div>
  )
}
