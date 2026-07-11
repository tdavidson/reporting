import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, PhoneCall } from 'lucide-react'
import { requireAccountingAdmin } from '../guard'
import { CapitalCallsView } from './view'

export const metadata: Metadata = { title: 'Capital calls' }

export default async function CapitalCallsPage() {
  await requireAccountingAdmin()
  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
      <Link href="/accounting" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />Accounting
      </Link>
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><PhoneCall className="h-6 w-6" />Capital calls</h1>
        <p className="text-sm text-muted-foreground">
          Issue calls against LP commitments and track called vs funded. A call recognizes each LP&apos;s
          contribution and a receivable; the wire that funds it clears the receivable (recorded on the
          Bank transactions page).
        </p>
      </div>
      <CapitalCallsView />
    </div>
  )
}
