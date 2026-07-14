// The accounting section's navigation — the single source of truth for both the
// sidebar (labels only) and the /funds hub page (icons + descriptions).
// Add a route here and it appears in both; there is nowhere else to add it.

import {
  Landmark, Users, ScrollText, Gauge,
  Lock, Layers, FileText,
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
    href: '/funds/status',
    label: 'Admin',
    icon: Gauge,
    desc: 'Current status and admin settings.',
  },
  {
    href: '/funds/bank',
    label: 'Bank transactions',
    icon: Landmark,
    desc: 'Import a transaction feed (XLSX, CSV, Ramp, QuickBooks), auto-draft entries, and create journal entries.',
  },
  {
    href: '/funds/capital-accounts',
    label: 'Capital accounts',
    icon: Users,
    desc: "Per-partner roll-forward and commitments, plus called and unfunded. Issue capital calls and publish LP capital statements.",
  },
  // NOTE: /funds/lp-events is deliberately NOT listed — it now redirects here. LP
  // capital events are not a separate destination: they are one of the two producers a
  // capital account can read from, so they belong ON the capital accounts page, and only
  // for a vehicle that actually uses them (capital_source='events'). Surfacing them in
  // the nav offered them to every vehicle, including the fully-booked ones where anything
  // entered there is ignored.
  {
    href: '/funds/journal',
    label: 'Journal',
    icon: ScrollText,
    desc: 'Plain-text double-entry journal entries. Create, view, unpost, and edit all journal entries.',
  },
  // NOTE: /funds/opening-balances is deliberately NOT listed. It only applies to
  // the "cutover" onboarding path, and is linked from the setup card there. On a
  // full-history vehicle, opening balances are derived from the reconstructed ledger —
  // entering them would double-count contributed capital.
  // NOTE: /funds/allocation-terms is deliberately NOT listed. It's configuration
  // you set once per vehicle (basis, commitments, who bears which category), not a
  // place you work — so it's linked from Admin, next to the health check that tells
  // you when it's wrong.
  {
    href: '/funds/periods',
    label: 'Period close',
    icon: Lock,
    desc: "Close a period: allocate its income and expenses to each partner's capital account, snapshot the ledger, and lock the books. Reopen to reverse.",
  },
  {
    href: '/funds/schedule-of-investments',
    label: 'Schedule of investments',
    icon: Layers,
    desc: 'Each investment at cost and fair value, with its share of net assets.',
  },
  {
    href: '/funds/statements',
    label: 'Financial statements',
    icon: FileText,
    desc: 'Balance sheet, income statement, statement of cash flows, and statement of changes in partners capital.',
  },
]
