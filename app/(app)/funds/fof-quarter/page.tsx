import type { Metadata } from 'next'
import { requireAccountingAccess } from '../guard'
import { FofQuarterView } from './view'

export const metadata: Metadata = { title: 'Quarterly close — underlying funds' }

// The bare route. The fund-first route lives at /funds/[id]/fof-quarter and renders the
// same view — the pairing every other fund subpage uses.
export default async function FofQuarterPage() {
  await requireAccountingAccess()
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FofQuarterView />
    </div>
  )
}
