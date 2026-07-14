import type { Metadata } from 'next'
import { requireAccountingAccess } from '../guard'
import { AllocationTermsView } from './view'

export const metadata: Metadata = { title: 'Allocation terms' }

export default async function AllocationTermsPage() {
  await requireAccountingAccess()
  return (
    <div className="px-4 md:pl-8 md:pr-4 pt-3 pb-8 w-full">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Allocation terms</h1>
        <p className="text-sm text-muted-foreground">
          How the period close splits income and expenses across partners: the allocation basis,
          each partner&rsquo;s commitment over time, and who bears which categories.
        </p>
      </div>
      <AllocationTermsView />
    </div>
  )
}
