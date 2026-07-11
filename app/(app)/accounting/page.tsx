import type { Metadata } from 'next'
import Link from 'next/link'
import { BookOpen, Users, GitCompareArrows, ScrollText, Layers, FileText, Calculator, Sparkles, Landmark, FileCode, Lock, PhoneCall } from 'lucide-react'
import { requireAccountingAdmin } from './guard'
import { AccountingSetup } from './setup'

export const metadata: Metadata = { title: 'Accounting' }

const SECTIONS = [
  {
    href: '/accounting/bank',
    label: 'Bank transactions',
    icon: Landmark,
    desc: 'Import a transaction feed (CSV, Ramp, QuickBooks), auto-draft entries, and reconcile ledger cash against the bank.',
  },
  {
    href: '/accounting/capital-accounts',
    label: 'Capital accounts',
    icon: Users,
    desc: 'Per-LP roll-forward: beginning → contributions → distributions → fees → gains → ending.',
  },
  {
    href: '/accounting/capital-calls',
    label: 'Capital calls',
    icon: PhoneCall,
    desc: 'Issue calls against commitments (fund-wide pro-rata or per-LP) and track called vs funded vs outstanding.',
  },
  {
    href: '/accounting/allocations',
    label: 'Allocations',
    icon: Calculator,
    desc: 'Compute and post a management fee or partnership expense, split per LP to each capital account.',
  },
  {
    href: '/accounting/reconciliation',
    label: 'Reconciliation',
    icon: GitCompareArrows,
    desc: "Shadow-reconcile the ledger's capital accounts against the existing admin statement, per LP.",
  },
  {
    href: '/accounting/draft',
    label: 'Draft from document',
    icon: Sparkles,
    desc: 'Paste a capital-call notice or invoice; AI proposes a balanced entry for you to review and post.',
  },
  {
    href: '/accounting/journal',
    label: 'Journal',
    icon: ScrollText,
    desc: 'Double-entry journal entries and postings — the book of record everything derives from.',
  },
  {
    href: '/accounting/ledger-text',
    label: 'Plain text',
    icon: FileCode,
    desc: 'Author entries as plain-text double-entry and post them back — the DB is just the store.',
  },
  {
    href: '/accounting/periods',
    label: 'Periods',
    icon: Lock,
    desc: 'Close and lock a reporting period — freeze the books and snapshot the ledger text for audit.',
  },
  {
    href: '/accounting/schedule-of-investments',
    label: 'Schedule of investments',
    icon: Layers,
    desc: 'Each investment at cost and fair value, with its share of net assets — derived from the ledger.',
  },
  {
    href: '/accounting/statements',
    label: 'Financial statements',
    icon: FileText,
    desc: 'Balance sheet, income statement, and statement of changes in partners’ capital.',
  },
]

export default async function AccountingPage() {
  await requireAccountingAdmin()

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <BookOpen className="h-6 w-6" />
          Accounting
        </h1>
        <p className="text-sm text-muted-foreground">
          Double-entry ledger and the capital accounts, schedule of investments, and financial
          statements derived from it.
        </p>
      </div>

      <AccountingSetup />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {SECTIONS.map(({ href, label, icon: Icon, desc }) => (
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
