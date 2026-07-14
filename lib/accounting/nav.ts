// The accounting section's navigation — the single source of truth for both the
// sidebar (labels only) and the /accounting hub page (icons + descriptions).
// Add a route here and it appears in both; there is nowhere else to add it.

import {
  Landmark, Users, ScrollText, Gauge,
  Lock, Layers, FileText, ListTree,
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
    label: 'Admin',
    icon: Gauge,
    desc: 'Current status and admin settings.',
  },
  {
    href: '/accounting/bank',
    label: 'Bank transactions',
    icon: Landmark,
    desc: 'Import a transaction feed (XLSX, CSV, Ramp, QuickBooks), auto-draft entries, and create journal entries.',
  },
  {
    href: '/accounting/capital-accounts',
    label: 'Capital accounts',
    icon: Users,
    desc: "Per-partner roll-forward and commitments, plus called and unfunded. Issue capital calls and publish LP capital statements.",
  },
  {
    href: '/accounting/lp-events',
    label: 'LP capital events',
    icon: ListTree,
    desc: "Capital movements for a vehicle you don't keep books on — an SPV, a direct investment, a fund whose administrator sends you a statement. They feed the same capital accounts and LP report as a full ledger.",
  },
  {
    href: '/accounting/journal',
    label: 'Journal',
    icon: ScrollText,
    desc: 'Plain-text double-entry journal entries. Create, view, unpost, and edit all journal entries.',
  },
  // NOTE: /accounting/opening-balances is deliberately NOT listed. It only applies to
  // the "cutover" onboarding path, and is linked from the setup card there. On a
  // full-history vehicle, opening balances are derived from the reconstructed ledger —
  // entering them would double-count contributed capital.
  // NOTE: /accounting/allocation-terms is deliberately NOT listed. It's configuration
  // you set once per vehicle (basis, commitments, who bears which category), not a
  // place you work — so it's linked from Admin, next to the health check that tells
  // you when it's wrong.
  {
    href: '/accounting/periods',
    label: 'Period close',
    icon: Lock,
    desc: "Close a period: allocate its income and expenses to each partner's capital account, snapshot the ledger, and lock the books. Reopen to reverse.",
  },
  {
    href: '/accounting/schedule-of-investments',
    label: 'Schedule of investments',
    icon: Layers,
    desc: 'Each investment at cost and fair value, with its share of net assets.',
  },
  {
    href: '/accounting/statements',
    label: 'Financial statements',
    icon: FileText,
    desc: 'Balance sheet, income statement, statement of cash flows, and statement of changes in partners capital.',
  },
]
