import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, FileCode } from 'lucide-react'
import { requireAccountingAdmin } from '../guard'
import { LedgerTextView } from './view'

export const metadata: Metadata = { title: 'Plain text' }

export default async function LedgerTextPage() {
  await requireAccountingAdmin()
  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
      <Link href="/accounting" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />Accounting
      </Link>
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><FileCode className="h-6 w-6" />Plain text</h1>
        <p className="text-sm text-muted-foreground">
          The plain-text double-entry surface. Your whole set of books is here as text — edit it, or
          write new entries, and post them back. The database is just the store; text is how you
          author.
        </p>
      </div>
      <LedgerTextView />
    </div>
  )
}
