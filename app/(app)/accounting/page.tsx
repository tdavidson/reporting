import type { Metadata } from 'next'
import Link from 'next/link'
import { ACCOUNTING_SECTIONS } from '@/lib/accounting/nav'
import { requireAccountingAdmin } from './guard'
import { AccountingSetup } from './setup'

export const metadata: Metadata = { title: 'Accounting' }

export default async function AccountingPage() {
  await requireAccountingAdmin()

  return (
    <div className="px-4 md:pl-8 md:pr-4 pt-3 pb-8 w-full">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Accounting</h1>
        <p className="text-sm text-muted-foreground">
          Double-entry ledger and the capital accounts, schedule of investments, and financial
          statements derived from it.
        </p>
      </div>

      <AccountingSetup />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {ACCOUNTING_SECTIONS.map(({ href, label, icon: Icon, desc }) => (
          <Link
            key={href}
            href={href}
            className="border rounded-lg p-4 hover:bg-accent transition-colors flex gap-3"
          >
            <Icon className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
