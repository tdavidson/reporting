// Which domain owns each table — the database half of the access model.
//
// `route-domains.ts` answers "may this caller CALL this route?" and `page-domains.ts` answers the
// same for a server page. Both are application gates, and both are bypassed entirely by a browser
// that skips Next.js and talks to PostgREST with the public anon key and its own JWT. That is
// SEC-002: the app's per-domain grants existed only in TypeScript, while RLS said "any member of
// the fund may read this, and any non-viewer may write it".
//
// So this registry is the third: every table in `public` gets a rule, and the RLS migration
// (20260902174637_enforce_domain_access_rls.sql) is written against it. `table-domains.test.ts`
// fails when a table exists in a migration but not here, so a new table cannot ship without
// someone answering the question — the same shape as the route and page registries.
//
// The database-side resolver is `public.domain_access(fund_id, domain, feature)`, which mirrors
// `effectiveAccess` in lib/access/effective.ts check for check. `rls-domain-parity.test.ts` pins
// the two together: the feature defaults and primary-feature map are duplicated into SQL, and a
// silent drift there is a silent grant.

import type { Domain } from './domains'
import type { FeatureKey } from '@/lib/types/features'

export type TableRule =
  /**
   * Fund-scoped, gated by a domain. The common case.
   *
   * SELECT needs `read` in `domain`, INSERT/UPDATE/DELETE need `write`. `feature` names the
   * fund-level switch when the domain spans several (`relationships` covers `interactions` and
   * `notes`; a fund switches those independently), exactly as the route gates do.
   */
  | { scope: 'fund'; domain: Domain; feature?: FeatureKey; note?: string }
  /**
   * Fund-scoped and PRIVATE TO ITS OWNER: `user_id = auth.uid()` on top of fund membership, with
   * no domain gate because the row belongs to the user rather than to a content area.
   *
   * This is the conversation fix. Analyst conversation summaries are replayed into the system
   * prompt, so "every member may read and write every member's conversations" was not only a
   * disclosure but a persistent prompt-injection channel between colleagues.
   */
  | { scope: 'owner'; column: string; note: string }
  /** Owner-private with no fund column at all — keyed on the user directly. */
  | { scope: 'user'; column: string; note: string }
  /**
   * Fund-scoped, readable by whoever holds ANY of several domains, written by one.
   *
   * RLS policies are permissive and OR together, so "readable by accounting OR lp_capital OR
   * gp_economics OR portfolio" is expressible directly rather than by widening to every member.
   */
  | { scope: 'multi'; read: Domain[]; write: Domain; note: string }
  /**
   * Fund-scoped, readable by ANY member, writable by admins only. For the small set of tables the
   * app itself reads with the user-context client before it knows anything about grants — the
   * feature map that decides the nav, the vehicle registry every domain names.
   */
  | { scope: 'member'; note: string }
  /** Fund-scoped, and the ROW names its own domain in a `domain` column. Only `pending_actions`. */
  | { scope: 'row_domain'; column: string; note: string }
  /** No fund column; reached through a parent row that has one. */
  | { scope: 'parent'; domain: Domain; parent: string; column: string; parentKey?: string }
  /**
   * Not reachable through the Data API at all: `anon` and `authenticated` lose every privilege and
   * the service role keeps them. Credentials, tokens, and infrastructure counters — nothing a
   * browser should be able to name, let alone select.
   */
  | { scope: 'service'; note: string }
  /** Global reference data with no tenant: readable by any signed-in user, written by the service role. */
  | { scope: 'reference'; note: string }
  /** Deliberately world-readable. */
  | { scope: 'public'; note: string }
  /**
   * Left exactly as it is. Its existing policies already express something this registry's shapes
   * do not — LP-portal identity, self-service membership — and rewriting them generically would
   * lose it. Every entry says why.
   */
  | { scope: 'keep'; note: string }

export const TABLE_RULES: Record<string, TableRule> = {
  // ---- Portfolio ---------------------------------------------------------------------------
  companies: { scope: 'fund', domain: 'portfolio' },
  company_documents: { scope: 'fund', domain: 'portfolio' },
  company_summaries: { scope: 'fund', domain: 'portfolio' },
  metrics: { scope: 'fund', domain: 'portfolio' },
  metric_values: { scope: 'fund', domain: 'portfolio' },
  default_metrics: { scope: 'fund', domain: 'portfolio' },
  default_metric_exclusions: { scope: 'fund', domain: 'portfolio' },
  // NOT feature 'imports': that key gates the import ROUTES (api/import*), not the review
  // queue. Gating the queue on it made /review return nothing for a member of a fund whose
  // imports switch is admin-only — a blank page, proven against the live database.
  parsing_reviews: { scope: 'fund', domain: 'portfolio' },
  ask_response_overrides: { scope: 'fund', domain: 'portfolio', feature: 'asks' },
  investment_transactions: { scope: 'fund', domain: 'portfolio', feature: 'investments' },
  // The mailbox is portfolio INTAKE, not deal flow — ROUTE_DOMAINS says so for every api/emails*
  // route, with a comment about the 403 that taught them. Filing it under dealflow here meant a
  // fund with `deals: off` served /emails/[id] and then showed nothing in it.
  inbound_emails: { scope: 'fund', domain: 'portfolio' },
  // The "asks" table — api/requests* is portfolio + asks.
  email_requests: { scope: 'fund', domain: 'portfolio', feature: 'asks' },
  fund_group_config: { scope: 'fund', domain: 'portfolio' },
  fund_cash_flows: { scope: 'fund', domain: 'portfolio' },
  // The fund-of-funds register: our holdings IN other funds, which is a position like any other.
  fund_capital_events: { scope: 'fund', domain: 'portfolio', feature: 'investments' },
  fund_holding_terms: { scope: 'fund', domain: 'portfolio', feature: 'investments' },
  fund_nav_statements: { scope: 'fund', domain: 'portfolio', feature: 'investments' },

  // ---- Relationships (candid internal commentary — the reason this domain is separable) -----
  interactions: { scope: 'fund', domain: 'relationships', feature: 'interactions' },
  company_notes: { scope: 'fund', domain: 'relationships', feature: 'notes' },
  note_company_subscriptions: { scope: 'owner', column: 'user_id', note: 'One user’s subscriptions.' },
  note_notification_preferences: { scope: 'owner', column: 'user_id', note: 'One user’s preferences.' },
  note_reads: { scope: 'user', column: 'user_id', note: 'Read receipts, keyed on the user; no fund column.' },

  // ---- Deal flow ---------------------------------------------------------------------------
  inbound_deals: { scope: 'fund', domain: 'dealflow' },
  known_referrers: { scope: 'fund', domain: 'dealflow' },
  routing_corrections: { scope: 'fund', domain: 'dealflow' },

  // (The heartbeat_* tables were dropped by 20260723000001; `fund_notes` by 20260301000002, which
  //  folded it into company_notes with a null company_id; `lp_associates_overrides` by
  //  20260722000000. A dropped table gets no rule — see the note on DROPPED_TABLES in the test.)

  // ---- Diligence ---------------------------------------------------------------------------
  diligence_deals: { scope: 'fund', domain: 'diligence' },
  diligence_documents: { scope: 'fund', domain: 'diligence' },
  diligence_notes: { scope: 'fund', domain: 'diligence' },
  diligence_memo_drafts: { scope: 'fund', domain: 'diligence' },
  diligence_agent_sessions: { scope: 'fund', domain: 'diligence' },
  diligence_attention_items: { scope: 'fund', domain: 'diligence' },
  diligence_call_transcripts: { scope: 'fund', domain: 'diligence' },
  diligence_checklist_items: { scope: 'fund', domain: 'diligence' },
  diligence_qa_chats: { scope: 'fund', domain: 'diligence' },
  firm_schemas: { scope: 'fund', domain: 'diligence' },
  style_anchor_memos: { scope: 'fund', domain: 'diligence' },
  memo_agent_prompts: { scope: 'fund', domain: 'diligence' },
  fund_memo_presets: { scope: 'fund', domain: 'diligence' },

  // ---- Accounting --------------------------------------------------------------------------
  chart_of_accounts: { scope: 'fund', domain: 'accounting' },
  journal_entries: { scope: 'fund', domain: 'accounting' },
  journal_postings: { scope: 'fund', domain: 'accounting' },
  fiscal_periods: { scope: 'fund', domain: 'accounting' },
  bank_transactions: { scope: 'fund', domain: 'accounting' },
  allocation_runs: { scope: 'fund', domain: 'accounting' },
  allocation_results: { scope: 'fund', domain: 'accounting' },
  vehicle_accounting_settings: { scope: 'fund', domain: 'accounting' },
  qb_account_mappings: { scope: 'fund', domain: 'accounting' },
  qb_import_runs: { scope: 'fund', domain: 'accounting' },
  fund_construction_models: { scope: 'fund', domain: 'accounting' },
  // Marks and wallet balances are ledger inputs: api/accounting/crypto-wallets and
  // api/accounting/price-feeds. Filing them under portfolio was LOOSER than the route registry.
  crypto_wallets: { scope: 'fund', domain: 'accounting' },
  crypto_wallet_balances: { scope: 'fund', domain: 'accounting' },
  price_feeds: { scope: 'fund', domain: 'accounting' },
  price_observations: { scope: 'fund', domain: 'accounting' },

  // ---- LP capital --------------------------------------------------------------------------
  lp_entities: { scope: 'fund', domain: 'lp_capital' },
  lp_investors: { scope: 'fund', domain: 'lp_capital' },
  lp_investments: { scope: 'fund', domain: 'lp_capital' },
  lp_snapshots: { scope: 'fund', domain: 'lp_capital' },
  lp_positions: { scope: 'fund', domain: 'lp_capital', feature: 'lp_tracking' },
  lp_capital_events: { scope: 'fund', domain: 'lp_capital' },
  capital_calls: { scope: 'fund', domain: 'lp_capital' },
  capital_call_lines: { scope: 'fund', domain: 'lp_capital' },
  distributions: { scope: 'fund', domain: 'lp_capital' },
  distribution_lines: { scope: 'fund', domain: 'lp_capital' },
  commitment_events: { scope: 'fund', domain: 'lp_capital' },
  partner_allocation_terms: { scope: 'fund', domain: 'lp_capital' },

  // ---- GP economics (carry is NOT structurally part of the ledger — see DOMAIN_META) --------
  carry_payments: { scope: 'fund', domain: 'gp_economics' },
  vehicle_partner_ownership: { scope: 'fund', domain: 'gp_economics' },
  vehicle_gp_links: { scope: 'fund', domain: 'gp_economics' },
  vehicle_waterfall_terms: { scope: 'fund', domain: 'gp_economics' },

  // ---- LP relations ------------------------------------------------------------------------
  lp_letters: { scope: 'fund', domain: 'lp_relations', feature: 'lp_letters' },
  lp_letter_templates: { scope: 'fund', domain: 'lp_relations', feature: 'lp_letters' },
  lp_letter_shares: { scope: 'fund', domain: 'lp_relations', feature: 'lp_letters' },
  lp_documents: { scope: 'fund', domain: 'lp_relations', feature: 'lp_portal' },
  lp_document_shares: { scope: 'fund', domain: 'lp_relations', feature: 'lp_portal' },
  lp_snapshot_shares: { scope: 'fund', domain: 'lp_relations', feature: 'lp_portal' },
  lp_live_report_shares: { scope: 'fund', domain: 'lp_relations', feature: 'lp_portal' },
  lp_messages: { scope: 'fund', domain: 'lp_relations', feature: 'lp_portal' },
  lp_access_events: { scope: 'fund', domain: 'lp_relations', feature: 'lp_activity' },

  // ---- Compliance --------------------------------------------------------------------------
  compliance_filings: { scope: 'fund', domain: 'compliance' },
  compliance_deadlines: { scope: 'fund', domain: 'compliance' },
  compliance_links: { scope: 'fund', domain: 'compliance' },
  compliance_fund_settings: { scope: 'fund', domain: 'compliance' },
  fund_compliance_profile: { scope: 'fund', domain: 'compliance' },
  compliance_workflows: { scope: 'parent', domain: 'compliance', parent: 'compliance_deadlines', column: 'deadline_id' },
  compliance_entry_data: { scope: 'parent', domain: 'compliance', parent: 'compliance_deadlines', column: 'deadline_id' },
  compliance_items: { scope: 'reference', note: 'The regulatory catalogue itself — the same rows for every fund.' },

  // ---- Administration ----------------------------------------------------------------------
  authorized_senders: { scope: 'fund', domain: 'admin', note: 'Who may mail data INTO the fund. SEC-001 made this admin-only in the app.' },
  ai_usage_logs: { scope: 'fund', domain: 'admin', note: 'Spend and prompt metadata across every domain.' },
  user_activity_logs: { scope: 'owner', column: 'user_id', note: 'One user\u2019s own trail. api/auth/activity returns the caller\u2019s; the admin audit view reads it with the service role.' },

  // ---- Read-by-any-member, written by admins -------------------------------------------------
  fund_settings: {
    scope: 'member',
    note: 'The feature map decides the nav, so every member reads it before any grant is resolved — and two server pages read it with the USER client (app/(app)/companies/[id], /emails/[id]). Gating it to admins would blank those pages.',
  },
  fund_vehicles: {
    scope: 'multi',
    read: ['accounting', 'lp_capital', 'gp_economics', 'portfolio'],
    write: 'accounting',
    note: 'Four domains name a vehicle; none of them owns it. Permissive policies OR together, so this says exactly that rather than widening to every member. The names are not the sensitive part — the balances hanging off them are, and those are gated on their own tables.',
  },

  // ---- Row carries its own domain ------------------------------------------------------------
  pending_actions: {
    scope: 'row_domain',
    column: 'domain',
    note: 'A staged write names the domain it would write to, so the row gates itself: drafting needs read, approving needs write, and neither leaks an accounting action to someone holding only portfolio.',
  },

  // ---- Owner-private -------------------------------------------------------------------------
  analyst_conversations: {
    scope: 'owner',
    column: 'user_id',
    note: 'Summaries are replayed into the Analyst system prompt, so a colleague who could write your conversation could write your prompt. Owner-only is the containment.',
  },

  // ---- Never through the Data API ------------------------------------------------------------
  fund_api_keys: { scope: 'service', note: 'API key material.' },
  affinity_credentials: { scope: 'service', note: 'Per-user Affinity API key.' },
  oauth_clients: { scope: 'service', note: 'Client secrets and the redirect-URI allowlist.' },
  oauth_tokens: { scope: 'service', note: 'Access/refresh token hashes.' },
  oauth_authorization_codes: { scope: 'service', note: 'Single-use authorization codes and PKCE challenges.' },
  app_settings: { scope: 'service', note: 'Global inbound address and its webhook token.' },
  allowed_signups: { scope: 'service', note: 'The signup allowlist decides who may exist at all.' },
  rate_limit_entries: { scope: 'service', note: 'Counters; readable rows would make the limiter forgeable.' },
  demo_sessions: { scope: 'service', note: 'Anonymous demo telemetry, written server-side.' },
  memo_agent_jobs: { scope: 'service', note: 'Already locked down by 20260509000002_memo_agent_jobs_lockdown.sql.' },
  api_idempotency_keys: { scope: 'service', note: 'Stored response bodies for /api/v1 financial approvals, replayed on retry.' },

  // ---- Deliberately public -------------------------------------------------------------------
  site_content: { scope: 'public', note: 'The marketing page renders it unauthenticated. Admin-written.' },

  // ---- Left alone, with reasons ---------------------------------------------------------------
  funds: { scope: 'keep', note: 'Membership defines the tenant; its policy is the root of get_my_fund_ids and predates domains.' },
  fund_members: { scope: 'keep', note: 'You must be able to read your own membership before any domain can be resolved.' },
  fund_member_access: { scope: 'keep', note: 'Already own-grants-or-admin (20260716000008); a domain gate here would be circular.' },
  fund_domain_defaults: { scope: 'keep', note: 'Same — the inputs to the resolver cannot be gated by the resolver.' },
  fund_join_requests: { scope: 'keep', note: 'A request is made by someone who is not yet a member, so membership cannot gate it.' },
  lp_accounts: { scope: 'keep', note: 'LP-portal identity: rows belong to LP users who are not fund members at all.' },
  lp_account_links: { scope: 'keep', note: 'Binds an LP portal account to an investor; read by the portal as that LP.' },
  lp_authorized_users: { scope: 'keep', note: 'An LP’s delegates — governed by the LP’s own account, not by fund domains.' },
}

/** Tables whose rows are private to one user, whatever their fund role. */
export function isOwnerScoped(table: string): boolean {
  const rule = TABLE_RULES[table]
  return rule?.scope === 'owner' || rule?.scope === 'user'
}

/** The domain gating a table, or null when its rule is not domain-shaped. */
export function domainForTable(table: string): Domain | null {
  const rule = TABLE_RULES[table]
  if (!rule) return null
  return rule.scope === 'fund' || rule.scope === 'parent' ? rule.domain : null
}
