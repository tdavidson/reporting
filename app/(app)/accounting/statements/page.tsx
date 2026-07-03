import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, FileText } from 'lucide-react'
import { requireAccountingAdmin } from '../guard'
import { StatementsView } from './view'

export const metadata: Metadata = { title: 'Financial statements' }

export default async function StatementsPage() {
  await requireAccountingAdmin()
  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
      <Link href="/accounting" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />Accounting
      </Link>
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><FileText className="h-6 w-6" />Financial statements</h1>
        <p className="text-sm text-muted-foreground">
          Balance sheet, income statement, and statement of changes in partners&rsquo; capital — all
          derived from the ledger. (Statement of cash flows to follow.)
        </p>
      </div>
      <StatementsView />
    </div>
  )
}
