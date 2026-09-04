// Which domain every PAGE belongs to — the server-component counterpart of ROUTE_DOMAINS.
//
// The API registry closed one hole and left its twin open. `gateApiRequest` resolves every /api
// request before the handler runs, so a route cannot serve data it hasn't earned. A server
// component makes no API request: it queries Postgres itself, often with the ADMIN client, and
// renders the result. The middleware never sees it. So "the page is only an affordance, the API is
// the boundary" is true right up until the page IS the thing serving the data — and then the only
// gate is the one the page remembers to call.
//
// It was remembered on 11 pages of 24. /emails/[id] rendered a whole message body (raw_payload
// included) to any member with the URL; /deals and /deals/[id] rendered founder pitches with the
// service-role client, in funds where the Deals product is off by default. Both were reachable
// while the sidebar correctly hid them — the exact "hidden means hidden" failure the access model
// was written to end.
//
// page-domains.test.ts is what makes this stick: every server component under app/(app) must be
// mapped here (and actually call the gate it claims) or listed in UNGATED_PAGES with a reason.
//
// Client pages are absent on purpose. They render no fund data on the server — everything they
// show arrives through an /api call the middleware already gated — so there is nothing here for
// them to declare. If one is later converted to a server component, it stops being a client page
// and the test starts asking.
//
// See plans/plan-access-control.md.

import type { Domain } from './domains'
import type { FeatureKey } from '@/lib/types/features'

export interface PageDomain {
  domain: Domain
  /** Overrides the domain's primary switch, exactly as in ROUTE_DOMAINS. */
  feature?: FeatureKey
  /**
   * The gate this page calls, when it isn't the standard `canViewPage(page, '<domain>')`.
   * Section guards resolve the same context for a whole subtree.
   */
  gate?: 'requireAccountingAccess' | 'requireMancoAccess' | 'requireMancoLedgerAccess'
}

/** Keyed by path under app/(app), without the trailing /page.tsx. */
export const PAGE_DOMAINS: Record<string, PageDomain> = {
  // ── Portfolio ──────────────────────────────────────────────────────────────
  'dashboard': { domain: 'portfolio' },
  // The company page: the panels inside it (notes, interactions, investments) each ask for their
  // own domain, but the company and its metrics are portfolio.
  'companies/[id]': { domain: 'portfolio' },
  // Portfolio update search — the Company Updates corpus (reporting email), not the mailbox.
  'company-updates': { domain: 'portfolio' },
  // The mailbox is portfolio intake, not deal flow — see ROUTE_DOMAINS['api/emails'].
  'emails/[id]': { domain: 'portfolio' },

  // ── Relationships ──────────────────────────────────────────────────────────
  'interactions': { domain: 'relationships', feature: 'interactions' },

  // ── Deal flow ──────────────────────────────────────────────────────────────
  'deals': { domain: 'dealflow' },
  'deals/[id]': { domain: 'dealflow' },

  // ── Diligence ──────────────────────────────────────────────────────────────
  'diligence': { domain: 'diligence' },
  'diligence/[id]': { domain: 'diligence' },
  'diligence/[id]/qa': { domain: 'diligence' },
  'diligence/[id]/drafts/[draftId]': { domain: 'diligence' },
  'diligence/analytics': { domain: 'diligence' },
  'diligence/inbox': { domain: 'diligence' },
  // The memo agent's configuration IS diligence configuration: rubric, Q&A library, style anchors.
  'settings/memo-agent/defaults': { domain: 'diligence' },
  'settings/memo-agent/schemas': { domain: 'diligence' },
  'settings/memo-agent/schemas/[name]': { domain: 'diligence' },
  'settings/memo-agent/style-anchors': { domain: 'diligence' },
  'settings/memo-agent/style-anchors/[id]': { domain: 'diligence' },

  // ── LP reporting ───────────────────────────────────────────────────────────
  'lps/capital': { domain: 'lp_capital', feature: 'lp_tracking' },
  'lp-portal': { domain: 'lp_relations', feature: 'lp_portal' },
  'lp-activity': { domain: 'lp_relations', feature: 'lp_activity' },

  // ── Fund accounting ────────────────────────────────────────────────────────
  // The whole section shares one guard (app/(app)/funds/guard.ts), which resolves the caller and
  // redirects before any page body runs.
  //
  // It resolves through canViewPage like every other gate here. It used to compare roles instead
  // (admin|viewer, grant ignored), which meant a member granted accounting write was served by
  // every accounting API and redirected off every accounting page — pinned against now by
  // tests/route-gates-honour-grants.test.ts.
  'funds': { domain: 'accounting', gate: 'requireAccountingAccess' },
  // Also the firm-wide landing for every section (/funds/journal, /funds/status, …): the `[id]`
  // slot holds a section slug, and the page lists every entity with a link to that section.
  'funds/[id]': { domain: 'accounting', gate: 'requireAccountingAccess' },
  'funds/[id]/bank': { domain: 'accounting', gate: 'requireAccountingAccess' },
  'funds/[id]/capital-accounts': { domain: 'accounting', gate: 'requireAccountingAccess' },
  'funds/[id]/construction': { domain: 'accounting', gate: 'requireAccountingAccess' },
  'funds/[id]/capital-accounts/[lpEntityId]': { domain: 'accounting', gate: 'requireAccountingAccess' },
  'funds/[id]/fof-quarter': { domain: 'accounting', gate: 'requireAccountingAccess' },
  'funds/[id]/fof-report': { domain: 'accounting', gate: 'requireAccountingAccess' },
  'funds/[id]/journal': { domain: 'accounting', gate: 'requireAccountingAccess' },
  'funds/[id]/ledger': { domain: 'accounting', gate: 'requireAccountingAccess' },
  // Gated in the page itself on the domain AND the tax_reporting feature: every route behind it
  // is feature-gated, so the page must not render when the feature is off.
  'funds/[id]/tax': { domain: 'accounting', feature: 'tax_reporting' },
  'funds/[id]/migrate': { domain: 'accounting', gate: 'requireAccountingAccess' },
  'funds/[id]/opening-balances': { domain: 'accounting', gate: 'requireAccountingAccess' },
  'funds/[id]/periods': { domain: 'accounting', gate: 'requireAccountingAccess' },
  'funds/[id]/schedule-of-investments': { domain: 'accounting', gate: 'requireAccountingAccess' },
  'funds/[id]/statements': { domain: 'accounting', gate: 'requireAccountingAccess' },
  'funds/[id]/status': { domain: 'accounting', gate: 'requireAccountingAccess' },

  // ── Management company ─────────────────────────────────────────────────────
  // Its own section and its own guard (app/(app)/manco/guard.ts), because a manco's ledger carries
  // firm payroll and none of it is derivable from a fund's books — see DOMAIN_META.
  //
  // The ledger subpages claim `requireMancoLedgerAccess`, which checks `management_company`
  // AND `accounting`. They render the SHARED accounting views, whose API calls the middleware gates
  // on `accounting`; admitting someone without it would render a page whose every request 403s.
  // The domain recorded here is the one that decides whether the page is reachable AT ALL.
  //
  // `manco` itself is the Management landing — every entity, every kind — and reads the books
  // through /api/accounting/firm, which the middleware gates on `accounting`; a caller holding
  // only this grant gets the management companies alone from /api/manco/vehicles instead.
  'manco': { domain: 'management_company', gate: 'requireMancoAccess' },
  'manco/[id]': { domain: 'management_company', gate: 'requireMancoAccess' },
  'manco/[id]/bank': { domain: 'management_company', gate: 'requireMancoLedgerAccess' },
  'manco/[id]/journal': { domain: 'management_company', gate: 'requireMancoLedgerAccess' },
  'manco/[id]/ledger': { domain: 'management_company', gate: 'requireMancoLedgerAccess' },
  'manco/[id]/migrate': { domain: 'management_company', gate: 'requireMancoLedgerAccess' },
  'manco/[id]/periods': { domain: 'management_company', gate: 'requireMancoLedgerAccess' },
  'manco/[id]/statements': { domain: 'management_company', gate: 'requireMancoLedgerAccess' },

  // ── Administration ─────────────────────────────────────────────────────────
  'usage': { domain: 'admin' },
  'updates': { domain: 'admin' },
}

/**
 * Server components that need no gate, each with the reason. A page qualifies only if it renders
 * NO fund data server-side: a redirect, or a document. "The nav hides it" is not a reason — that
 * was the bug.
 */
export const UNGATED_PAGES: Record<string, string> = {
  'accounting/[[...rest]]': 'Pure redirect to /funds for old deep links. Renders nothing.',
  'companies': 'Pure redirect to /dashboard. Renders nothing.',
  'funds/[id]/text': 'Pure redirect to the journal page’s plain-text tab. Renders nothing; the journal page gates.',
  'manco/[id]/text': 'Pure redirect to the manco journal page’s plain-text tab. Renders nothing; the journal page gates.',
  'lps/live': 'Pure redirect to /lps — the live report became the LPs landing page.',
  'support': 'Static product documentation. No fund data, no queries, same for every reader.',
}
