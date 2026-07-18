// Which domain every API route belongs to, and what it takes to call it.
//
// This registry is the mechanism that makes access control hold. Before it, 137 of 263 routes
// checked only "are you in this fund" and never looked at role — not by decision, but because
// nothing made them. A declarative map plus the coverage test in route-domains.test.ts means a new
// route cannot ship without an answer: it is either mapped to a domain, or explicitly listed as
// ungated WITH A REASON. Discipline didn't hold this; the test does.
//
// See plans/plan-access-control.md.

import type { Domain } from './domains'
import type { AccessLevel } from './effective'
import type { FeatureKey } from '@/lib/types/features'

export type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * What a route can require. `none` is deliberately absent — a route requiring no access is an
 * ungated route, and those live in UNGATED_ROUTES with a reason.
 *
 * `any` = any member of the fund, no domain grant needed. The escape hatch, for routes that serve
 * a user their OWN data (their theme, their conversations) or that gate internally per domain (the
 * Analyst). Every use carries a comment saying which. It is not a synonym for "unimportant".
 */
export type RouteLevel = Exclude<AccessLevel, 'none'> | 'any'

export interface RouteAccess {
  domain: Domain
  /** Overrides the domain's primary switch — for domains spanning several feature keys. */
  feature?: FeatureKey
  /**
   * What the route needs. Omitted = derived from the method: GET/HEAD read, everything else write.
   * Set it where the method lies (a POST that only queries) or where reads and writes differ.
   */
  level?: RouteLevel | Partial<Record<Method, RouteLevel>>
}

/** Reads are reads; anything else changes something. Overridable per route above. */
export function requiredLevel(entry: RouteAccess, method: string): RouteLevel {
  const m = method.toUpperCase() as Method
  if (entry.level && typeof entry.level === 'object') {
    return entry.level[m] ?? defaultForMethod(m)
  }
  return entry.level ?? defaultForMethod(m)
}

function defaultForMethod(m: Method): RouteLevel {
  return m === 'GET' || m === 'HEAD' ? 'read' : 'write'
}

export const ROUTE_DOMAINS: Record<string, RouteAccess> = {
  // ── Fund accounting ────────────────────────────────────────────────────────
  'api/accounting/allocation-terms': { domain: 'accounting' },
  'api/accounting/assistant': { domain: 'accounting' },
  'api/accounting/bank': { domain: 'accounting' },
  'api/accounting/bank/categorize': { domain: 'accounting' },
  'api/accounting/bank/import': { domain: 'accounting' },
  'api/accounting/bank/match': { domain: 'accounting' },
  'api/accounting/bank/reconcile': { domain: 'accounting' },
  'api/accounting/bootstrap': { domain: 'accounting' },
  'api/accounting/chart': { domain: 'accounting' },
  'api/accounting/cutover': { domain: 'accounting' },
  'api/accounting/fund-economics': { domain: 'accounting' },
  'api/accounting/fund-timeseries': { domain: 'accounting' },
  'api/accounting/investments': { domain: 'accounting' },
  'api/accounting/journal': { domain: 'accounting' },
  'api/accounting/ledger-text': { domain: 'accounting' },
  'api/accounting/opening-balances': { domain: 'accounting' },
  'api/accounting/periods': { domain: 'accounting' },

  'api/accounting/statements': { domain: 'accounting' },
  // The Excel workpaper export ships the exact same computed package as the statements
  // route, so it carries the same domain (accounting implies lp_capital via DOMAIN_META).
  'api/accounting/statements/export': { domain: 'accounting' },
  'api/accounting/status': { domain: 'accounting' },
  'api/accounting/vehicles': { domain: 'accounting' },
  'api/accounting/vehicle-index': { domain: 'accounting' },
  'api/vehicles': { domain: 'accounting' },

  // ── GP economics — the carve-out. These used to sit behind the single `accounting` key,
  //    so anyone who could reconcile the bank could read the partners' carry.
  'api/accounting/deal-carry': { domain: 'gp_economics' },
  'api/accounting/gp-economics': { domain: 'gp_economics' },
  'api/accounting/waterfall-terms': { domain: 'gp_economics' },
  'api/lps/associates-calculate': { domain: 'gp_economics', feature: 'lp_associates' },
  'api/lps/associates-overrides': { domain: 'gp_economics', feature: 'lp_associates' },

  // ── LP capital: identities, commitments, capital accounts ──────────────────
  'api/accounting/capital-accounts': { domain: 'lp_capital' },
  'api/accounting/capital-calls': { domain: 'lp_capital' },
  'api/accounting/commitments': { domain: 'lp_capital' },
  'api/accounting/entities': { domain: 'lp_capital' },
  'api/accounting/lp-events': { domain: 'lp_capital' },
  'api/accounting/lp-events/import': { domain: 'lp_capital' },
  'api/accounting/lp-statement': { domain: 'lp_capital' },
  'api/accounting/lp-statement/pdf': { domain: 'lp_capital' },
  'api/accounting/lps': { domain: 'lp_capital' },
  // Returns each partner's ledger capital account WITH their name, to diff against the
  // administrator's figures. The `reconcile` tool is gated the same way.
  'api/accounting/reconciliation': { domain: 'lp_capital' },
  'api/accounting/positions': { domain: 'lp_capital', feature: 'lp_tracking' },
  'api/accounting/positions/import': { domain: 'lp_capital', feature: 'lp_tracking' },
  'api/lps/entities': { domain: 'lp_capital' },
  'api/lps/export/excel': { domain: 'lp_capital' },
  'api/lps/export/pdf': { domain: 'lp_capital' },
  'api/lps/import': { domain: 'lp_capital' },
  'api/lps/investments': { domain: 'lp_capital' },
  'api/lps/investor-groups': { domain: 'lp_capital' },
  'api/lps/investors': { domain: 'lp_capital' },
  'api/lps/live-cards': { domain: 'lp_capital' },
  'api/lps/live-report': { domain: 'lp_capital' },
  'api/lps/live-settings': { domain: 'lp_capital' },
  'api/lps/snapshots': { domain: 'lp_capital' },
  'api/lps/snapshots/from-live': { domain: 'lp_capital' },
  'api/lps/vehicles': { domain: 'lp_capital' },

  // ── LP relations: what goes OUT to LPs, and the record of them reading it ──
  //    Sharing is the sensitive verb here, so the share routes sit here rather than with the
  //    capital data they happen to share.
  'api/accounting/lp-statement/publish': { domain: 'lp_relations', feature: 'lp_portal' },
  'api/lps/live-report/share': { domain: 'lp_relations', feature: 'lp_portal' },
  'api/lps/snapshots/[id]/share': { domain: 'lp_relations', feature: 'lp_portal' },
  'api/lps/authorized-users': { domain: 'lp_relations', feature: 'lp_portal' },
  'api/lps/documents': { domain: 'lp_relations', feature: 'lp_portal' },
  'api/lps/documents/upload-url': { domain: 'lp_relations', feature: 'lp_portal' },
  'api/lps/invites': { domain: 'lp_relations', feature: 'lp_portal' },
  'api/lps/invites/bulk': { domain: 'lp_relations', feature: 'lp_portal' },
  'api/lps/messages': { domain: 'lp_relations', feature: 'lp_portal' },
  'api/lps/send': { domain: 'lp_relations', feature: 'lp_portal' },
  // "View as LP" renders a NAMED investor's own capital position — commitment, paid-in,
  // distributions, NAV — and the statement PDF renders the whole thing. That is lp_capital data
  // wearing the portal's chrome, so it takes the lp_capital grant (still behind the lp_portal
  // switch). Gating it as lp_relations let anyone who merely sends LP letters read the register.
  'api/lps/preview': { domain: 'lp_capital', feature: 'lp_portal' },
  'api/lps/preview/document/[id]': { domain: 'lp_relations', feature: 'lp_portal' },
  'api/lps/preview/snapshot/[id]/pdf': { domain: 'lp_capital', feature: 'lp_portal' },
  'api/lp-activity': { domain: 'lp_relations', feature: 'lp_activity' },
  'api/lp-letters': { domain: 'lp_relations', feature: 'lp_letters' },
  'api/lp-letters/[id]': { domain: 'lp_relations', feature: 'lp_letters' },
  'api/lp-letters/[id]/export': { domain: 'lp_relations', feature: 'lp_letters' },
  'api/lp-letters/[id]/generate': { domain: 'lp_relations', feature: 'lp_letters' },
  'api/lp-letters/[id]/generate/[companyId]': { domain: 'lp_relations', feature: 'lp_letters' },
  'api/lp-letters/[id]/share': { domain: 'lp_relations', feature: 'lp_letters' },
  'api/lp-letters/example': { domain: 'lp_relations', feature: 'lp_letters' },
  'api/lp-letters/preview': { domain: 'lp_relations', feature: 'lp_letters' },
  'api/lp-letters/templates': { domain: 'lp_relations', feature: 'lp_letters' },
  'api/lp-letters/templates/[id]': { domain: 'lp_relations', feature: 'lp_letters' },

  // ── Portfolio ─────────────────────────────────────────────────────────────
  'api/companies': { domain: 'portfolio' },
  'api/companies/[id]': { domain: 'portfolio' },
  'api/companies/[id]/default-metrics': { domain: 'portfolio' },
  'api/companies/[id]/default-metrics/[defaultId]': { domain: 'portfolio' },
  'api/companies/[id]/documents': { domain: 'portfolio' },
  'api/companies/[id]/documents/[docId]': { domain: 'portfolio' },
  'api/companies/[id]/investments': { domain: 'portfolio', feature: 'investments' },
  'api/companies/[id]/investments/[txnId]': { domain: 'portfolio', feature: 'investments' },
  'api/companies/[id]/metrics': { domain: 'portfolio' },
  'api/companies/[id]/metrics/[metricId]/values': { domain: 'portfolio' },
  'api/companies/[id]/summary': { domain: 'portfolio' },
  'api/dashboard/table-data': { domain: 'portfolio' },
  'api/default-metrics': { domain: 'portfolio' },
  'api/default-metrics/[id]': { domain: 'portfolio' },
  'api/default-metrics/apply': { domain: 'portfolio' },
  'api/import': { domain: 'portfolio', feature: 'imports' },
  'api/import/documents': { domain: 'portfolio', feature: 'imports' },
  'api/import/fund-cash-flows': { domain: 'portfolio', feature: 'imports' },
  'api/import/investments': { domain: 'portfolio', feature: 'imports' },
  'api/metric-values/[id]': { domain: 'portfolio' },
  'api/metrics/[id]': { domain: 'portfolio' },
  'api/portfolio/fund-cash-flows': { domain: 'portfolio' },
  'api/portfolio/fund-cash-flows/import': { domain: 'portfolio', feature: 'imports' },
  'api/portfolio/fund-group-config': { domain: 'portfolio' },
  'api/portfolio/investments': { domain: 'portfolio', feature: 'investments' },
  'api/requests': { domain: 'portfolio', feature: 'asks' },
  'api/requests/responses': { domain: 'portfolio', feature: 'asks' },
  'api/requests/send': { domain: 'portfolio', feature: 'asks' },
  'api/review': { domain: 'portfolio' },
  'api/review/[id]/resolve': { domain: 'portfolio' },

  // ── Relationships: candid internal commentary ──────────────────────────────
  'api/companies/[id]/interactions': { domain: 'relationships', feature: 'interactions' },
  'api/companies/[id]/notes': { domain: 'relationships', feature: 'notes' },
  'api/companies/[id]/notes/[noteId]': { domain: 'relationships', feature: 'notes' },
  'api/dashboard/notes': { domain: 'relationships', feature: 'notes' },
  'api/dashboard/notes/[noteId]': { domain: 'relationships', feature: 'notes' },
  'api/interactions': { domain: 'relationships', feature: 'interactions' },
  'api/notes': { domain: 'relationships', feature: 'notes' },
  'api/notes/members': { domain: 'relationships', feature: 'notes' },
  // Marking a note read is the reader's own state, not a note edit.
  'api/notes/mark-read': { domain: 'relationships', feature: 'notes', level: 'read' },

  // ── Deal flow ─────────────────────────────────────────────────────────────
  'api/deals': { domain: 'dealflow' },
  'api/deals/[id]': { domain: 'dealflow' },
  'api/deals/[id]/regenerate': { domain: 'dealflow' },
  'api/deals/[id]/research': { domain: 'dealflow' },
  'api/deals/manual': { domain: 'dealflow' },
  'api/deals/preview': { domain: 'dealflow' },
  'api/known-referrers': { domain: 'dealflow' },
  'api/known-referrers/[id]': { domain: 'dealflow' },
  'api/emails': { domain: 'dealflow' },
  'api/emails/[id]': { domain: 'dealflow' },
  'api/emails/[id]/attachment/[index]': { domain: 'dealflow' },
  'api/emails/[id]/attachments': { domain: 'dealflow' },
  'api/emails/[id]/reprocess': { domain: 'dealflow' },
  'api/emails/[id]/reroute': { domain: 'dealflow' },
  'api/emails/[id]/reviews': { domain: 'dealflow' },
  'api/emails/save-to-drive': { domain: 'dealflow' },

  // ── Diligence ─────────────────────────────────────────────────────────────
  // These two promote INTO diligence, so they're gated on the destination — the more sensitive of
  // the two domains they touch.
  'api/deals/[id]/promote-to-diligence': { domain: 'diligence' },
  'api/emails/[id]/accept-to-diligence': { domain: 'diligence' },
  'api/diligence': { domain: 'diligence' },
  'api/diligence/[id]': { domain: 'diligence' },
  'api/diligence/[id]/affinity': { domain: 'diligence' },
  'api/diligence/[id]/agent/checklist-assessment': { domain: 'diligence' },
  'api/diligence/[id]/agent/draft': { domain: 'diligence' },
  'api/diligence/[id]/agent/ingest': { domain: 'diligence' },
  'api/diligence/[id]/agent/qa/add-question': { domain: 'diligence' },
  'api/diligence/[id]/agent/qa/entry': { domain: 'diligence' },
  'api/diligence/[id]/agent/qa/finish': { domain: 'diligence' },
  'api/diligence/[id]/agent/qa/next-batch': { domain: 'diligence' },
  'api/diligence/[id]/agent/qa/respond': { domain: 'diligence' },
  'api/diligence/[id]/agent/render': { domain: 'diligence' },
  'api/diligence/[id]/agent/research': { domain: 'diligence' },
  'api/diligence/[id]/agent/score': { domain: 'diligence' },
  'api/diligence/[id]/agent/status': { domain: 'diligence' },
  'api/diligence/[id]/agent/transcribe': { domain: 'diligence' },
  'api/diligence/[id]/attention': { domain: 'diligence' },
  'api/diligence/[id]/attention/[itemId]': { domain: 'diligence' },
  'api/diligence/[id]/checklist': { domain: 'diligence' },
  'api/diligence/[id]/documents': { domain: 'diligence' },
  'api/diligence/[id]/documents/[docId]': { domain: 'diligence' },
  'api/diligence/[id]/documents/drive-files': { domain: 'diligence' },
  'api/diligence/[id]/documents/from-affinity': { domain: 'diligence' },
  'api/diligence/[id]/documents/from-drive': { domain: 'diligence' },
  'api/diligence/[id]/documents/upload-url': { domain: 'diligence' },
  'api/diligence/[id]/drafts': { domain: 'diligence' },
  'api/diligence/[id]/drafts/[draftId]': { domain: 'diligence' },
  'api/diligence/[id]/drafts/[draftId]/finalize': { domain: 'diligence' },
  'api/diligence/[id]/email-intake': { domain: 'diligence' },
  'api/diligence/[id]/memo-config': { domain: 'diligence' },
  'api/diligence/[id]/notes': { domain: 'diligence' },
  'api/diligence/[id]/notes/[noteId]': { domain: 'diligence' },
  // The Q&A chat reads evidence and answers; it doesn't change the deal.
  'api/diligence/[id]/qa-chat': { domain: 'diligence', level: 'read' },
  'api/diligence/[id]/usage': { domain: 'diligence' },
  'api/diligence/analytics': { domain: 'diligence' },
  'api/diligence/checklist-template': { domain: 'diligence' },
  'api/diligence/inbox': { domain: 'diligence' },
  'api/diligence/memo-presets': { domain: 'diligence' },
  'api/diligence/memo-presets/[presetId]': { domain: 'diligence' },
  'api/diligence/prompts': { domain: 'diligence' },
  // The memo agent's firm-wide configuration: house style, schemas, defaults.
  'api/firm/memo-agent-defaults': { domain: 'diligence' },
  'api/firm/schemas': { domain: 'diligence' },
  'api/firm/schemas/[name]': { domain: 'diligence' },
  'api/firm/schemas/[name]/history': { domain: 'diligence' },
  'api/firm/schemas/[name]/rollback': { domain: 'diligence' },
  'api/firm/style-anchors': { domain: 'diligence' },
  'api/firm/style-anchors/[id]': { domain: 'diligence' },
  'api/firm/style-anchors/upload-url': { domain: 'diligence' },

  // ── Compliance ────────────────────────────────────────────────────────────
  'api/compliance': { domain: 'compliance' },
  'api/compliance/links': { domain: 'compliance' },
  'api/compliance/profile': { domain: 'compliance' },
  'api/compliance/settings': { domain: 'compliance' },

  // ── Administration ────────────────────────────────────────────────────────
  'api/settings/deal-research': { domain: 'admin' },
  'api/settings/deal-submission-token': { domain: 'admin' },
  'api/settings/drive': { domain: 'admin' },
  'api/settings/drive/folders': { domain: 'admin' },
  'api/settings/dropbox': { domain: 'admin' },
  'api/settings/dropbox/folders': { domain: 'admin' },
  'api/settings/heartbeat': { domain: 'admin' },
  'api/settings/senders': { domain: 'admin' },
  'api/settings/senders/[id]': { domain: 'admin' },
  // The control panel for who can see what: reading it maps the fund's data.
  'api/settings/access': { domain: 'admin' },
  'api/settings/whitelist': { domain: 'admin' },
  'api/settings/whitelist/[id]': { domain: 'admin' },
  'api/onboarding/inbound-email': { domain: 'admin' },
  'api/onboarding/postmark': { domain: 'admin' },
  'api/onboarding/senders': { domain: 'admin' },
  'api/usage': { domain: 'admin' },
  'api/test-claude-key': { domain: 'admin' },
  'api/test-gemini-key': { domain: 'admin' },
  'api/test-ollama': { domain: 'admin' },
  'api/test-openai-key': { domain: 'admin' },
  'api/transcription/test': { domain: 'admin' },
  // Reading fund settings feeds the app shell for every member. Writing is *mostly* administration
  // — but `displayName` is deliberately member-writable ("any user can do this"), and the route
  // already refuses every admin-only field to a non-admin via its `hasAdminFields` check. Gating
  // the whole PATCH as admin took away a member's own name.
  'api/settings': { domain: 'admin', level: { GET: 'any', PATCH: 'any' } },
  // Any member sees the team roster; changing it is administration.
  'api/settings/members': { domain: 'admin', level: { GET: 'any' } },
  'api/settings/members/[id]': { domain: 'admin' },

  // ── A member's own data — membership is the whole test ─────────────────────
  // The Analyst gates each domain block internally against this same resolver, so gating the route
  // on any one domain would wrongly deny a member who holds a different one.
  'api/analyst': { domain: 'portfolio', level: 'any' },
  // A user's own conversations, scoped by user_id in the route.
  'api/analyst/conversations': { domain: 'portfolio', level: 'any' },
  'api/analyst/conversations/[id]': { domain: 'portfolio', level: 'any' },
  // Personal preferences, not fund data.
  'api/settings/theme': { domain: 'portfolio', level: 'any' },
  'api/settings/notifications': { domain: 'portfolio', level: 'any' },
  'api/auth/activity': { domain: 'portfolio', level: 'any' },
  'api/contact': { domain: 'portfolio', level: 'any' },
  // Affinity issues ONE KEY PER USER, scoped to that user's own permissions, so each member
  // connects their own. It lives under /settings but it is not administration.
  'api/settings/affinity': { domain: 'portfolio', level: 'any' },
  // A member's OWN agent credentials: GET lists only their keys, POST mints one for them. The
  // route refuses the read-only demo itself, and every call the key later makes is re-checked
  // against its owner's live grants — so the key can never exceed them. Gating this as admin
  // contradicted the whole point: a member granted write in a domain must be able to drive it
  // from an agent, which means being able to create the credential.
  'api/accounting/keys': { domain: 'portfolio', level: 'any' },
  // Same reasoning: this is the member authorizing an MCP client to act AS THEM. `grantableScope`
  // already caps what the token may carry, and the demo is refused in the handler.
  'api/oauth/consent': { domain: 'portfolio', level: 'any' },
}

/**
 * Entries whose route file may legitimately be ABSENT from a clone — local-only surfaces kept out
 * of git (see .gitignore). Mapped as normal on a machine that has them; missing everywhere else,
 * and the coverage test must not report that as a stale entry.
 *
 * Keep this tiny. A route that is merely unused should be deleted, not listed here.
 */
export const OPTIONAL_ROUTES = new Set<string>([
  // The demo fixtures are Hemrock-specific marketing content, not product — they live outside git.
  'api/demo/seed',
])

/**
 * Routes with no domain gate, each with the reason it needs none. A route belongs here only if it
 * authenticates by some other means or serves no fund data — "it seemed fine" is not a reason.
 */
export const UNGATED_ROUTES: Record<string, string> = {
  // Pre-authentication, or the act of authenticating.
  'api/auth/branding': 'Pre-auth: login page branding.',
  'api/auth/dropbox': 'OAuth start; the callback establishes identity.',
  'api/auth/dropbox/callback': 'OAuth callback.',
  'api/auth/google': 'OAuth start.',
  'api/auth/google/callback': 'OAuth callback.',
  'api/auth/logout': 'Ends a session.',
  'api/auth/signup': 'Pre-auth by definition.',
  'api/setup': 'First-run bootstrap, before any fund exists.',
  'api/onboarding/check-domain': 'Pre-fund: is this email domain claimed.',
  'api/onboarding/fund': 'Creates the fund and its first admin.',
  'api/onboarding/join': 'Requests membership; the caller has none yet.',

  // Their own credential, not a session. These resolve an API key or OAuth token and enforce
  // access per tool — see lib/accounting/api-keys.ts.
  'api/mcp': 'MCP: authenticates by API key/OAuth token; gated per tool by domain.',
  'api/accounting/mcp': 'MCP (legacy path): as api/mcp.',
  'api/agent': 'Agent REST: as api/mcp.',

  // OAuth protocol surface for the MCP server.
  'api/oauth/metadata/authorization-server': 'RFC 8414 metadata; public by spec.',
  'api/oauth/metadata/protected-resource': 'RFC 9728 metadata; public by spec.',
  'api/oauth/register': 'RFC 7591 dynamic client registration.',
  'api/oauth/revoke': 'Bearer-token revocation.',
  'api/oauth/token': 'Token exchange; the credential is the auth.',

  // Service-triggered: shared CRON_SECRET, fail-closed if unset.
  'api/cron/affinity-sync': 'Cron: CRON_SECRET.',
  'api/cron/deal-research': 'Cron: CRON_SECRET.',
  'api/cron/deals-digest': 'Cron: CRON_SECRET.',
  'api/cron/heartbeat-backfill': 'Cron: CRON_SECRET.',
  'api/cron/memo-agent-worker': 'Cron: CRON_SECRET.',

  // Inbound from third parties, authenticated by a token in the path or a provider signature.
  'api/webhooks/heartbeat/[token]': 'Inbound webhook: high-entropy path token.',
  'api/webhooks/transcription/[secret]': 'Inbound webhook: path secret.',
  'api/inbound-email': 'Inbound email webhook.',
  'api/inbound-email/mailgun': 'Inbound email webhook (Mailgun).',
  'api/public/submit/[token]': 'Public deal-submission form; path token.',

  // A separate identity model: LP portal accounts, scoped per investor entity by resolveLpAccess.
  // Deliberately NOT merged into fund-member domains — see plans/plan-access-control.md.
  'api/portal/access-history': 'LP portal: resolveLpAccess.',
  'api/portal/activate': 'LP portal: invite activation.',
  'api/portal/analyst': 'LP portal: resolveLpAccess.',
  'api/portal/authorized-users': 'LP portal: resolveLpAccess.',
  'api/portal/contact': 'LP portal: resolveLpAccess.',
  'api/portal/documents': 'LP portal: resolveLpAccess.',
  'api/portal/documents/[id]': 'LP portal: resolveLpAccess.',
  'api/portal/letters': 'LP portal: resolveLpAccess.',
  'api/portal/letters/[id]': 'LP portal: resolveLpAccess.',
  'api/portal/letters/[id]/pdf': 'LP portal: resolveLpAccess.',
  'api/portal/me': 'LP portal: resolveLpAccess.',
  'api/portal/overview': 'LP portal: resolveLpAccess.',
  'api/portal/snapshots': 'LP portal: resolveLpAccess.',
  'api/portal/snapshots/[id]': 'LP portal: resolveLpAccess.',
  'api/portal/snapshots/[id]/pdf': 'LP portal: resolveLpAccess.',
  'api/portal/statement/pdf': 'LP portal: resolveLpAccess.',

  // No fund data: these list what models a configured provider offers, for the model picker.
  'api/claude-models': 'Model list; no fund data.',
  'api/gemini-models': 'Model list; no fund data.',
  'api/ollama-models': 'Model list; no fund data.',
  'api/openai-models': 'Model list; no fund data.',
  'api/github-stars': 'Public repo star count.',
  'api/og': 'Renders an OG card from its own query params; reads nothing.',

  // The demo fund's own bootstrap; it provisions the read-only demo, which holds no real data.
  'api/demo/credentials': 'Demo fund sign-in.',
  'api/demo/seed': 'Demo fund provisioning.',
}
