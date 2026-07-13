// The accounting section's navigation — the single source of truth for both the
// sidebar (labels only) and the /accounting hub page (icons + descriptions).
// Add a route here and it appears in both; there is nowhere else to add it.

import {
  Landmark, Users, PhoneCall, GitCompareArrows, Bot, ScrollText,
  Lock, Layers, FileText, SlidersHorizontal,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface AccountingSection {
  href: string
  label: string
  icon: LucideIcon
  desc: string
}

export const ACCOUNTING_SECTIONS: AccountingSection[] = [
  {
    href: '/accounting/status',
    label: 'Status',
    icon: GitCompareArrows,
    desc: 'Where the books stand: onboarding, how far the close has got, what needs attention, and reconciliation against an admin statement.',
  },
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
    href: '/accounting/assistant',
    label: 'Assistant',
    icon: Bot,
    desc: 'Ask AI to review your books, explain the statements, or draft entries — from a question or an uploaded document. Applied as drafts you approve; nothing posts automatically.',
  },
  {
    href: '/accounting/journal',
    label: 'Journal',
    icon: ScrollText,
    desc: 'The book of record, as plain-text double-entry. Create entries, and click any entry to view, unpost, or edit it.',
  },
  // NOTE: /accounting/opening-balances is deliberately NOT listed. It only applies to
  // the "cutover" onboarding path, and is linked from the setup card there. On a
  // full-history vehicle, opening balances are derived from the reconstructed ledger —
  // entering them would double-count contributed capital.
  {
    href: '/accounting/allocation-terms',
    label: 'Allocation terms',
    icon: SlidersHorizontal,
    desc: 'How the close splits P&L across partners: allocation basis, commitments over time, and which partners bear the management fee, expenses, and carry.',
  },
  {
    href: '/accounting/periods',
    label: 'Close',
    icon: Lock,
    desc: "Close a period: allocate its income and expenses to each partner's capital account, snapshot the ledger, and lock the books. Reopen to reverse.",
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
