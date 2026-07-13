import type { Metadata } from 'next'
import { requireAccountingAdmin } from '../guard'
import { StatusView } from './view'

export const metadata: Metadata = { title: 'Status' }

export default async function StatusPage() {
  await requireAccountingAdmin()
  return (
    <div className="px-4 md:pl-8 md:pr-4 pt-3 pb-8 w-full">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Status</h1>
        <p className="text-sm text-muted-foreground">
          Where this vehicle&rsquo;s books stand: onboarding, how far the close has got, and anything
          that needs attention before the next one.
        </p>
      </div>
      <StatusView />
    </div>
  )
}
