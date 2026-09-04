// The accounting section's navigation — the single source of truth for both the
// sidebar (labels only) and the /funds hub page (icons + descriptions).
// Add a route here and it appears in both; there is nowhere else to add it.

import {
  Landmark, Users, ScrollText, Gauge,
  Lock, Layers, FileText, Target, Table2, FileCode,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Domain } from '@/lib/access/domains'

export interface AccountingSection {
  href: string
  label: string
  icon: LucideIcon
  desc: string
  /**
   * The access domain this page needs, where it isn't plain `accounting`. The section is one nav
   * group but not one content area: capital accounts are LP identities and commitments, which a
   * member who reconciles the bank isn't thereby entitled to. Omitted = accounting.
   */
  domain?: Domain
  /** Only for a fund of funds — DERIVED from the data (at least one holding is a fund),
   *  never a setting. Consumers filter on it; see lib/portfolio/fof.ts. */
  requiresFof?: boolean
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
    // Named partners and their commitments — the same tier as the LPs section, reached from here.
    domain: 'lp_capital',
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
  {
    href: '/funds/ledger',
    label: 'General ledger',
    icon: Table2,
    desc: 'One account at a time: the balance carried in, every posting with what it was booked against, and the running balance.',
  },
  {
    href: '/funds/text',
    label: 'Plain text',
    icon: FileCode,
    desc: 'Author entries in the double-entry text format, checked against the chart as you type, and post them in one go.',
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
    href: '/funds/fof-report',
    label: 'Fund-of-funds report',
    icon: Layers,
    desc: 'Schedule of investments, commitments and liquidity, and per-fund performance for the underlying funds.',
    requiresFof: true,
  },
  // NOTE: /funds/migrate is deliberately NOT listed. Importing a QuickBooks general
  // ledger is a one-time event at the start of a vehicle's life, not a place you work —
  // so it's linked from Admin, alongside the rest of the onboarding.
  {
    href: '/funds/fof-quarter',
    label: 'Quarterly close (funds)',
    icon: Layers,
    desc: 'Paste the quarter\u2019s underlying-fund figures, confirm the notices, and book the period-end marks.',
    requiresFof: true,
  },
  {
    href: '/funds/schedule-of-investments',
    label: 'Schedule of investments',
    icon: Layers,
    desc: 'Each investment at cost and fair value, with its share of net assets.',
  },
  {
    href: '/funds/construction',
    label: 'Portfolio construction',
    icon: Target,
    desc: 'How much investable capital is left, how many more deals fit, and what exit the portfolio needs to return the fund.',
  },
  {
    href: '/funds/statements',
    label: 'Financial statements',
    icon: FileText,
    desc: 'Balance sheet, income statement, statement of cash flows, and statement of changes in partners capital.',
  },
]
