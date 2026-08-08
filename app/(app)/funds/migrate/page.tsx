import type { Metadata } from 'next'
import { requireAccountingAccess } from '../guard'
import { MigrateView } from './view'

export const metadata: Metadata = { title: 'Migrate from QuickBooks' }

export default async function MigratePage() {
  await requireAccountingAccess()
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <MigrateView />
    </div>
  )
}
