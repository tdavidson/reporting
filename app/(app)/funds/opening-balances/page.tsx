import type { Metadata } from 'next'
import { requireAccountingAccess } from '../guard'
import { OpeningBalancesView } from './view'
import { SnapshotCutover } from './snapshot-cutover'

export const metadata: Metadata = { title: 'Opening balances' }

export default async function OpeningBalancesPage() {
  await requireAccountingAccess()
  return (
    <div className="px-4 md:pl-8 md:pr-4 pt-3 pb-8 w-full">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Opening balances</h1>
        <p className="text-sm text-muted-foreground">
          Take over at a cutover date the way a fund admin does: enter each LP&rsquo;s capital balance
          from their most recent statement. This books one posted opening entry — no need to
          reconstruct history from inception.
        </p>
      </div>
      {/* The bulk route in: copy an existing LP snapshot into every vehicle at once, rather
          than typing each LP's balance by hand below. Fund-wide, so it sits above the
          vehicle-scoped form. */}
      <div className="mb-8">
        <SnapshotCutover />
      </div>

      <OpeningBalancesView />
    </div>
  )
}
