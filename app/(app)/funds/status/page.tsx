import type { Metadata } from 'next'
import { requireAccountingAccess } from '../guard'
import { StatusView } from './view'

export const metadata: Metadata = { title: 'Admin' }

export default async function StatusPage() {
  await requireAccountingAccess()
  return (
    <div className="px-4 md:pl-8 md:pr-4 pt-3 pb-8 w-full">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Where this vehicle&rsquo;s books stand — onboarding, how far the close has got, and anything
          that needs attention — plus the assistant and reconciliation against an admin statement.
        </p>
      </div>
      <StatusView />
    </div>
  )
}
