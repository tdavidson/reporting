import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, GitCompareArrows } from 'lucide-react'
import { requireAccountingAdmin } from '../guard'
import { ReconciliationView } from './view'

export const metadata: Metadata = { title: 'Reconciliation' }

export default async function ReconciliationPage() {
  await requireAccountingAdmin()
  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
      <Link href="/accounting" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />Accounting
      </Link>
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><GitCompareArrows className="h-6 w-6" />Reconciliation</h1>
        <p className="text-sm text-muted-foreground">
          Enter the admin&rsquo;s ending capital per LP, then reconcile: the ledger&rsquo;s capital
          accounts side-by-side with per-LP deltas. Ties out to the penny or the delta is localized.
        </p>
      </div>
      <ReconciliationView />
    </div>
  )
}
