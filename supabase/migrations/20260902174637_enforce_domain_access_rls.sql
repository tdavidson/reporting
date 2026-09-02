-- SEC-002 — put the per-domain access model into the database.
--
-- Until now the fund's per-domain grants existed only in TypeScript. `effectiveAccess`
-- (lib/access/effective.ts) is consulted by the middleware, the server pages, the Analyst, the MCP
-- server and the API keys — and by nothing at all in Postgres. RLS said something much weaker:
-- `get_my_fund_ids()` for reads (any member of the fund) and `is_fund_writer()` for writes (any
-- member who is not a viewer). A signed-in member could therefore skip Next.js entirely, point
-- supabase-js at PostgREST with the public anon key and their own JWT, and read construction
-- models, portfolio companies, GP carry, diligence documents, LP documents and pending actions
-- that the application would have refused them. Same fund, wrong domain.
--
-- This migration closes that. `public.domain_access()` mirrors `effectiveAccess` check for check
-- — fund switch as ceiling, admin-only domains, admins, the read-only viewer, the member's grant
-- falling back to the fund default, and the single accounting -> lp_capital implication — and every
-- fund-scoped table's policies are rewritten against it. The table-by-table decisions live in
-- lib/access/table-domains.ts, which `table-domains.test.ts` holds exhaustive, so a new table
-- cannot ship without an answer. `rls-domain-parity.test.ts` pins the two copies of the feature
-- defaults together.
--
-- Three shapes beyond the ordinary one:
--   * Owner-private rows (`analyst_conversations`) add `user_id = auth.uid()`. Conversation
--     summaries are replayed into the Analyst system prompt, so a colleague who could WRITE your
--     conversation could write your prompt — a persistent injection channel, not just a leak.
--   * `pending_actions` carries the domain of the write it would perform, so the row gates itself:
--     staging needs read in that domain, approving it needs write.
--   * Credential and infrastructure tables lose `anon` and `authenticated` privileges outright.
--     Nothing about them should be nameable from a browser.
--
-- Read alongside: docs/security-audit-2026-09-02.md (SEC-002), lib/access/effective.ts.

-- ============================================================================================
-- 1. The resolver, in SQL.
-- ============================================================================================

-- Ordering of the three levels, so "at least read" is a comparison rather than a list of strings.
create or replace function public.access_rank(p_level text)
returns int
language sql
immutable
parallel safe
as $$
  select case p_level when 'write' then 2 when 'read' then 1 else 0 end;
$$;

-- DEFAULT_FEATURE_VISIBILITY (lib/types/features.ts). A fund that has never touched a switch
-- resolves through these, so a drift here is a silent grant or a silent lockout — which is why
-- rls-domain-parity.test.ts compares this function's CASE arms with the TypeScript object.
create or replace function public.feature_default(p_feature text)
returns text
language sql
immutable
parallel safe
as $$
  select case p_feature
    when 'interactions'  then 'off'
    when 'investments'   then 'everyone'
    when 'notes'         then 'off'
    when 'lp_letters'    then 'off'
    when 'imports'       then 'everyone'
    when 'asks'          then 'admin'
    when 'lps'           then 'off'
    when 'lp_tracking'   then 'off'
    when 'lp_portal'     then 'off'
    when 'lp_activity'   then 'off'
    when 'compliance'    then 'off'
    when 'deals'         then 'off'
    when 'diligence'     then 'off'
    when 'accounting'    then 'off'
    when 'gp_economics'  then 'off'
    -- An unknown key is not a reason to open a door.
    else 'off'
  end;
$$;

-- DOMAIN_META[d].primaryFeature (lib/access/domains.ts). Null means the domain has no single
-- fund-level switch: it is either always on (portfolio, relationships, lp_relations) or governed
-- by role (admin). Callers pass an explicit feature for those.
create or replace function public.domain_primary_feature(p_domain text)
returns text
language sql
immutable
parallel safe
as $$
  select case p_domain
    when 'dealflow'     then 'deals'
    when 'diligence'    then 'diligence'
    when 'accounting'   then 'accounting'
    when 'lp_capital'   then 'lps'
    when 'gp_economics' then 'gp_economics'
    when 'compliance'   then 'compliance'
    else null
  end;
$$;

-- What this user may do in this domain, in this fund. The order of the checks IS the policy;
-- it is the same order as effectiveAccess() and should be changed in both places or neither.
create or replace function public.domain_access(
  p_fund_id uuid,
  p_domain  text,
  p_feature text default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    text;
  v_key     text;
  v_level   text;
  v_own     text;
  v_implied text;
begin
  if v_uid is null or p_fund_id is null or p_domain is null then
    return 'none';
  end if;

  select m.role into v_role
    from fund_members m
   where m.fund_id = p_fund_id and m.user_id = v_uid;
  if v_role is null then
    return 'none';
  end if;
  -- fund_members.role is text; anything unrecognised is the least power (normalizeRole).
  if v_role not in ('admin', 'member', 'viewer') then
    v_role := 'member';
  end if;

  -- The fund-level switch is a ceiling nobody clears.
  v_key := coalesce(p_feature, public.domain_primary_feature(p_domain));
  if v_key is null then
    v_level := 'everyone';
  else
    select coalesce(fs.feature_visibility ->> v_key, public.feature_default(v_key))
      into v_level
      from fund_settings fs
     where fs.fund_id = p_fund_id;
    v_level := coalesce(v_level, public.feature_default(v_key));
  end if;

  -- 'hidden' is legacy for 'off'. Both deny everyone, admins included: hiding a thing from the
  -- nav while the data still serves is the bug this model replaced.
  if v_level in ('off', 'hidden') then
    return 'none';
  end if;

  -- DOMAIN_META.admin.adminOnly
  if p_domain = 'admin' then
    return case when v_role = 'admin' then 'write' else 'none' end;
  end if;

  if v_role = 'admin' then
    return 'write';
  end if;

  -- The read-only demo reads everything switched on, including admin-level areas. Grants never
  -- widen it past read.
  if v_role = 'viewer' then
    return 'read';
  end if;

  if v_level = 'admin' then
    v_own := 'none';
  else
    select a.level into v_own
      from fund_member_access a
     where a.fund_id = p_fund_id and a.user_id = v_uid and a.domain = p_domain;
    if v_own is null then
      select d.level into v_own
        from fund_domain_defaults d
       where d.fund_id = p_fund_id and d.domain = p_domain;
    end if;
    v_own := coalesce(v_own, 'none');
  end if;

  -- The one implication, and it is an admission rather than a convenience: a fund's chart of
  -- accounts has one capital account per partner, NAMED for them, so granting the books has
  -- already granted partner capital. Deliberately after the off/hidden check (a hard deny on
  -- lp_capital still wins) and deliberately one hop only — accounting implies nothing, so this
  -- terminates.
  if p_domain = 'lp_capital' then
    v_implied := public.domain_access(p_fund_id, 'accounting');
    if public.access_rank(v_implied) > public.access_rank(v_own) then
      return v_implied;
    end if;
  end if;

  return v_own;
end;
$$;

-- The forms the policies actually use.
--
-- Taking the DOMAIN rather than the fund id is what keeps this cheap: the arguments are then
-- constants, so Postgres evaluates the function once per query instead of once per row. A user
-- belongs to exactly one fund (fund_members.user_id is unique, 20260511000001), so the array is
-- one element or none.
create or replace function public.fund_ids_readable(p_domain text, p_feature text default null)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(m.fund_id), array[]::uuid[])
    from fund_members m
   where m.user_id = auth.uid()
     and public.access_rank(public.domain_access(m.fund_id, p_domain, p_feature)) >= 1;
$$;

create or replace function public.fund_ids_writable(p_domain text, p_feature text default null)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(m.fund_id), array[]::uuid[])
    from fund_members m
   where m.user_id = auth.uid()
     and public.access_rank(public.domain_access(m.fund_id, p_domain, p_feature)) >= 2;
$$;

-- Per-row form, for the one table whose rows name their own domain.
create or replace function public.can_read_domain(p_fund_id uuid, p_domain text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.access_rank(public.domain_access(p_fund_id, p_domain)) >= 1; $$;

create or replace function public.can_write_domain(p_fund_id uuid, p_domain text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.access_rank(public.domain_access(p_fund_id, p_domain)) >= 2; $$;

-- SECURITY DEFINER reads fund_members, fund_settings and the grant tables past RLS, so who may
-- call these is the whole control. Never anonymously.
revoke execute on function public.domain_access(uuid, text, text) from public, anon;
revoke execute on function public.fund_ids_readable(text, text) from public, anon;
revoke execute on function public.fund_ids_writable(text, text) from public, anon;
revoke execute on function public.can_read_domain(uuid, text) from public, anon;
revoke execute on function public.can_write_domain(uuid, text) from public, anon;
grant execute on function public.domain_access(uuid, text, text) to authenticated, service_role;
grant execute on function public.fund_ids_readable(text, text) to authenticated, service_role;
grant execute on function public.fund_ids_writable(text, text) to authenticated, service_role;
grant execute on function public.can_read_domain(uuid, text) to authenticated, service_role;
grant execute on function public.can_write_domain(uuid, text) to authenticated, service_role;

comment on function public.domain_access(uuid, text, text) is
  'Effective per-domain access for auth.uid() in a fund. Mirrors effectiveAccess() in lib/access/effective.ts; the order of its checks is the policy.';

-- ============================================================================================
-- 2. Preflight.
--
-- Every name below is a table this migration writes a policy for. When the database has drifted
-- from the migration history, the first `create policy` fails with a bare `relation does not
-- exist` and you learn about exactly one missing table per push. This names all of them at once.
--
-- lib/access/table-domains.ts is built from the LIVE schema — tables created by a migration, minus
-- tables a later migration dropped. A name here that Postgres does not have therefore means the
-- registry and the database genuinely disagree, and the fix is the registry, not a skip.
-- ============================================================================================

do $$
declare
  t text;
  missing text[] := array[]::text[];
begin
  foreach t in array array[
    'companies', 'company_documents', 'company_summaries', 'metrics',
    'metric_values', 'default_metrics', 'default_metric_exclusions', 'parsing_reviews',
    'ask_response_overrides', 'investment_transactions', 'crypto_wallets', 'crypto_wallet_balances',
    'price_feeds', 'price_observations', 'fund_group_config', 'fund_cash_flows',
    'fund_capital_events', 'fund_holding_terms', 'fund_nav_statements', 'interactions',
    'company_notes', 'note_company_subscriptions', 'note_notification_preferences', 'note_reads',
    'inbound_deals', 'known_referrers', 'routing_corrections', 'inbound_emails',
    'email_requests', 'diligence_deals', 'diligence_documents', 'diligence_notes',
    'diligence_memo_drafts', 'diligence_agent_sessions', 'diligence_attention_items', 'diligence_call_transcripts',
    'diligence_checklist_items', 'diligence_qa_chats', 'firm_schemas', 'style_anchor_memos',
    'memo_agent_prompts', 'fund_memo_presets', 'chart_of_accounts', 'journal_entries',
    'journal_postings', 'fiscal_periods', 'bank_transactions', 'allocation_runs',
    'allocation_results', 'vehicle_accounting_settings', 'qb_account_mappings', 'qb_import_runs',
    'fund_construction_models', 'lp_entities', 'lp_investors', 'lp_investments',
    'lp_snapshots', 'lp_positions', 'lp_capital_events', 'capital_calls',
    'capital_call_lines', 'distributions', 'distribution_lines', 'commitment_events',
    'partner_allocation_terms', 'carry_payments', 'vehicle_partner_ownership', 'vehicle_gp_links',
    'vehicle_waterfall_terms', 'lp_letters', 'lp_letter_templates', 'lp_letter_shares',
    'lp_documents', 'lp_document_shares', 'lp_snapshot_shares', 'lp_live_report_shares',
    'lp_messages', 'lp_access_events', 'compliance_filings', 'compliance_deadlines',
    'compliance_links', 'compliance_fund_settings', 'fund_compliance_profile', 'compliance_workflows',
    'compliance_entry_data', 'compliance_items', 'authorized_senders', 'ai_usage_logs',
    'user_activity_logs', 'fund_settings', 'fund_vehicles', 'pending_actions',
    'analyst_conversations', 'fund_api_keys', 'affinity_credentials', 'oauth_clients',
    'oauth_tokens', 'oauth_authorization_codes', 'app_settings', 'allowed_signups',
    'rate_limit_entries', 'demo_sessions', 'memo_agent_jobs', 'site_content'
  ] loop
    if to_regclass('public.' || t) is null then
      missing := missing || t;
    end if;
  end loop;

  if array_length(missing, 1) > 0 then
    raise exception
      'SEC-002 RLS migration: % table(s) named in lib/access/table-domains.ts do not exist: %',
      array_length(missing, 1), array_to_string(missing, ', ');
  end if;
end $$;

-- ============================================================================================
-- 3. Clear the old policies on every table this migration re-states.
--
-- By name would be fragile: these tables have accumulated policies across forty migrations, some
-- renamed, some created twice. Dropping whatever is actually there and rebuilding is the only way
-- to be sure no permissive leftover survives underneath the new ones. Tables whose policies are
-- deliberately kept (membership, LP-portal identity — see table-domains.ts) are not in this list.
-- ============================================================================================

do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'companies', 'company_documents', 'company_summaries', 'metrics',
    'metric_values', 'default_metrics', 'default_metric_exclusions', 'parsing_reviews',
    'ask_response_overrides', 'investment_transactions', 'crypto_wallets', 'crypto_wallet_balances',
    'price_feeds', 'price_observations', 'fund_group_config', 'fund_cash_flows',
    'fund_capital_events', 'fund_holding_terms', 'fund_nav_statements', 'interactions',
    'company_notes', 'note_company_subscriptions', 'note_notification_preferences', 'note_reads',
    'inbound_deals', 'known_referrers', 'routing_corrections', 'inbound_emails',
    'email_requests', 'diligence_deals', 'diligence_documents', 'diligence_notes',
    'diligence_memo_drafts', 'diligence_agent_sessions', 'diligence_attention_items', 'diligence_call_transcripts',
    'diligence_checklist_items', 'diligence_qa_chats', 'firm_schemas', 'style_anchor_memos',
    'memo_agent_prompts', 'fund_memo_presets', 'chart_of_accounts', 'journal_entries',
    'journal_postings', 'fiscal_periods', 'bank_transactions', 'allocation_runs',
    'allocation_results', 'vehicle_accounting_settings', 'qb_account_mappings', 'qb_import_runs',
    'fund_construction_models', 'lp_entities', 'lp_investors', 'lp_investments',
    'lp_snapshots', 'lp_positions', 'lp_capital_events', 'capital_calls',
    'capital_call_lines', 'distributions', 'distribution_lines', 'commitment_events',
    'partner_allocation_terms', 'carry_payments', 'vehicle_partner_ownership', 'vehicle_gp_links',
    'vehicle_waterfall_terms', 'lp_letters', 'lp_letter_templates', 'lp_letter_shares',
    'lp_documents', 'lp_document_shares', 'lp_snapshot_shares', 'lp_live_report_shares',
    'lp_messages', 'lp_access_events', 'compliance_filings', 'compliance_deadlines',
    'compliance_links', 'compliance_fund_settings', 'fund_compliance_profile', 'compliance_workflows',
    'compliance_entry_data', 'compliance_items', 'authorized_senders', 'ai_usage_logs',
    'user_activity_logs', 'fund_settings', 'fund_vehicles', 'pending_actions',
    'analyst_conversations', 'fund_api_keys', 'affinity_credentials', 'oauth_clients',
    'oauth_tokens', 'oauth_authorization_codes', 'app_settings', 'allowed_signups',
    'rate_limit_entries', 'demo_sessions', 'memo_agent_jobs', 'site_content'
  ] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ============================================================================================
-- 4. Domain-gated tables.
-- ============================================================================================

-- ---- Portfolio ---------------------------------------------------------------------

create policy "companies read needs portfolio"
  on public.companies for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "companies insert needs portfolio write"
  on public.companies for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "companies update needs portfolio write"
  on public.companies for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')))
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "companies delete needs portfolio write"
  on public.companies for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')));

create policy "company_documents read needs portfolio"
  on public.company_documents for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "company_documents insert needs portfolio write"
  on public.company_documents for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "company_documents update needs portfolio write"
  on public.company_documents for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')))
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "company_documents delete needs portfolio write"
  on public.company_documents for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')));

create policy "company_summaries read needs portfolio"
  on public.company_summaries for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "company_summaries insert needs portfolio write"
  on public.company_summaries for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "company_summaries update needs portfolio write"
  on public.company_summaries for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')))
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "company_summaries delete needs portfolio write"
  on public.company_summaries for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')));

create policy "metrics read needs portfolio"
  on public.metrics for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "metrics insert needs portfolio write"
  on public.metrics for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "metrics update needs portfolio write"
  on public.metrics for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')))
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "metrics delete needs portfolio write"
  on public.metrics for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')));

create policy "metric_values read needs portfolio"
  on public.metric_values for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "metric_values insert needs portfolio write"
  on public.metric_values for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "metric_values update needs portfolio write"
  on public.metric_values for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')))
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "metric_values delete needs portfolio write"
  on public.metric_values for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')));

create policy "default_metrics read needs portfolio"
  on public.default_metrics for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "default_metrics insert needs portfolio write"
  on public.default_metrics for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "default_metrics update needs portfolio write"
  on public.default_metrics for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')))
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "default_metrics delete needs portfolio write"
  on public.default_metrics for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')));

create policy "default_metric_exclusions read needs portfolio"
  on public.default_metric_exclusions for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "default_metric_exclusions insert needs portfolio write"
  on public.default_metric_exclusions for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "default_metric_exclusions update needs portfolio write"
  on public.default_metric_exclusions for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')))
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "default_metric_exclusions delete needs portfolio write"
  on public.default_metric_exclusions for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')));

create policy "parsing_reviews read needs portfolio"
  on public.parsing_reviews for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio', 'imports')));
create policy "parsing_reviews insert needs portfolio write"
  on public.parsing_reviews for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio', 'imports')));
create policy "parsing_reviews update needs portfolio write"
  on public.parsing_reviews for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio', 'imports')))
  with check (fund_id = any(public.fund_ids_writable('portfolio', 'imports')));
create policy "parsing_reviews delete needs portfolio write"
  on public.parsing_reviews for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio', 'imports')));

create policy "ask_response_overrides read needs portfolio"
  on public.ask_response_overrides for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio', 'asks')));
create policy "ask_response_overrides insert needs portfolio write"
  on public.ask_response_overrides for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio', 'asks')));
create policy "ask_response_overrides update needs portfolio write"
  on public.ask_response_overrides for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio', 'asks')))
  with check (fund_id = any(public.fund_ids_writable('portfolio', 'asks')));
create policy "ask_response_overrides delete needs portfolio write"
  on public.ask_response_overrides for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio', 'asks')));

create policy "investment_transactions read needs portfolio"
  on public.investment_transactions for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio', 'investments')));
create policy "investment_transactions insert needs portfolio write"
  on public.investment_transactions for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio', 'investments')));
create policy "investment_transactions update needs portfolio write"
  on public.investment_transactions for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio', 'investments')))
  with check (fund_id = any(public.fund_ids_writable('portfolio', 'investments')));
create policy "investment_transactions delete needs portfolio write"
  on public.investment_transactions for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio', 'investments')));

create policy "crypto_wallets read needs portfolio"
  on public.crypto_wallets for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "crypto_wallets insert needs portfolio write"
  on public.crypto_wallets for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "crypto_wallets update needs portfolio write"
  on public.crypto_wallets for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')))
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "crypto_wallets delete needs portfolio write"
  on public.crypto_wallets for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')));

create policy "crypto_wallet_balances read needs portfolio"
  on public.crypto_wallet_balances for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "crypto_wallet_balances insert needs portfolio write"
  on public.crypto_wallet_balances for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "crypto_wallet_balances update needs portfolio write"
  on public.crypto_wallet_balances for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')))
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "crypto_wallet_balances delete needs portfolio write"
  on public.crypto_wallet_balances for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')));

create policy "price_feeds read needs portfolio"
  on public.price_feeds for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "price_feeds insert needs portfolio write"
  on public.price_feeds for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "price_feeds update needs portfolio write"
  on public.price_feeds for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')))
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "price_feeds delete needs portfolio write"
  on public.price_feeds for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')));

create policy "price_observations read needs portfolio"
  on public.price_observations for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "price_observations insert needs portfolio write"
  on public.price_observations for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "price_observations update needs portfolio write"
  on public.price_observations for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')))
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "price_observations delete needs portfolio write"
  on public.price_observations for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')));

create policy "fund_group_config read needs portfolio"
  on public.fund_group_config for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "fund_group_config insert needs portfolio write"
  on public.fund_group_config for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "fund_group_config update needs portfolio write"
  on public.fund_group_config for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')))
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "fund_group_config delete needs portfolio write"
  on public.fund_group_config for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')));

create policy "fund_cash_flows read needs portfolio"
  on public.fund_cash_flows for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "fund_cash_flows insert needs portfolio write"
  on public.fund_cash_flows for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "fund_cash_flows update needs portfolio write"
  on public.fund_cash_flows for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')))
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "fund_cash_flows delete needs portfolio write"
  on public.fund_cash_flows for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')));

create policy "fund_capital_events read needs portfolio"
  on public.fund_capital_events for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "fund_capital_events insert needs portfolio write"
  on public.fund_capital_events for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "fund_capital_events update needs portfolio write"
  on public.fund_capital_events for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')))
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "fund_capital_events delete needs portfolio write"
  on public.fund_capital_events for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')));

create policy "fund_holding_terms read needs portfolio"
  on public.fund_holding_terms for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "fund_holding_terms insert needs portfolio write"
  on public.fund_holding_terms for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "fund_holding_terms update needs portfolio write"
  on public.fund_holding_terms for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')))
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "fund_holding_terms delete needs portfolio write"
  on public.fund_holding_terms for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')));

create policy "fund_nav_statements read needs portfolio"
  on public.fund_nav_statements for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "fund_nav_statements insert needs portfolio write"
  on public.fund_nav_statements for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "fund_nav_statements update needs portfolio write"
  on public.fund_nav_statements for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')))
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "fund_nav_statements delete needs portfolio write"
  on public.fund_nav_statements for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')));

-- ---- Relationships -----------------------------------------------------------------

create policy "interactions read needs relationships"
  on public.interactions for select to authenticated
  using (fund_id = any(public.fund_ids_readable('relationships', 'interactions')));
create policy "interactions insert needs relationships write"
  on public.interactions for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('relationships', 'interactions')));
create policy "interactions update needs relationships write"
  on public.interactions for update to authenticated
  using (fund_id = any(public.fund_ids_writable('relationships', 'interactions')))
  with check (fund_id = any(public.fund_ids_writable('relationships', 'interactions')));
create policy "interactions delete needs relationships write"
  on public.interactions for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('relationships', 'interactions')));

create policy "company_notes read needs relationships"
  on public.company_notes for select to authenticated
  using (fund_id = any(public.fund_ids_readable('relationships', 'notes')));
create policy "company_notes insert needs relationships write"
  on public.company_notes for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('relationships', 'notes')));
create policy "company_notes update needs relationships write"
  on public.company_notes for update to authenticated
  using (fund_id = any(public.fund_ids_writable('relationships', 'notes')))
  with check (fund_id = any(public.fund_ids_writable('relationships', 'notes')));
create policy "company_notes delete needs relationships write"
  on public.company_notes for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('relationships', 'notes')));

-- ---- Deal flow ---------------------------------------------------------------------

create policy "inbound_deals read needs dealflow"
  on public.inbound_deals for select to authenticated
  using (fund_id = any(public.fund_ids_readable('dealflow')));
create policy "inbound_deals insert needs dealflow write"
  on public.inbound_deals for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('dealflow')));
create policy "inbound_deals update needs dealflow write"
  on public.inbound_deals for update to authenticated
  using (fund_id = any(public.fund_ids_writable('dealflow')))
  with check (fund_id = any(public.fund_ids_writable('dealflow')));
create policy "inbound_deals delete needs dealflow write"
  on public.inbound_deals for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('dealflow')));

create policy "known_referrers read needs dealflow"
  on public.known_referrers for select to authenticated
  using (fund_id = any(public.fund_ids_readable('dealflow')));
create policy "known_referrers insert needs dealflow write"
  on public.known_referrers for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('dealflow')));
create policy "known_referrers update needs dealflow write"
  on public.known_referrers for update to authenticated
  using (fund_id = any(public.fund_ids_writable('dealflow')))
  with check (fund_id = any(public.fund_ids_writable('dealflow')));
create policy "known_referrers delete needs dealflow write"
  on public.known_referrers for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('dealflow')));

create policy "routing_corrections read needs dealflow"
  on public.routing_corrections for select to authenticated
  using (fund_id = any(public.fund_ids_readable('dealflow')));
create policy "routing_corrections insert needs dealflow write"
  on public.routing_corrections for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('dealflow')));
create policy "routing_corrections update needs dealflow write"
  on public.routing_corrections for update to authenticated
  using (fund_id = any(public.fund_ids_writable('dealflow')))
  with check (fund_id = any(public.fund_ids_writable('dealflow')));
create policy "routing_corrections delete needs dealflow write"
  on public.routing_corrections for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('dealflow')));

create policy "inbound_emails read needs dealflow"
  on public.inbound_emails for select to authenticated
  using (fund_id = any(public.fund_ids_readable('dealflow')));
create policy "inbound_emails insert needs dealflow write"
  on public.inbound_emails for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('dealflow')));
create policy "inbound_emails update needs dealflow write"
  on public.inbound_emails for update to authenticated
  using (fund_id = any(public.fund_ids_writable('dealflow')))
  with check (fund_id = any(public.fund_ids_writable('dealflow')));
create policy "inbound_emails delete needs dealflow write"
  on public.inbound_emails for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('dealflow')));

create policy "email_requests read needs dealflow"
  on public.email_requests for select to authenticated
  using (fund_id = any(public.fund_ids_readable('dealflow')));
create policy "email_requests insert needs dealflow write"
  on public.email_requests for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('dealflow')));
create policy "email_requests update needs dealflow write"
  on public.email_requests for update to authenticated
  using (fund_id = any(public.fund_ids_writable('dealflow')))
  with check (fund_id = any(public.fund_ids_writable('dealflow')));
create policy "email_requests delete needs dealflow write"
  on public.email_requests for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('dealflow')));

-- ---- Diligence ---------------------------------------------------------------------

create policy "diligence_deals read needs diligence"
  on public.diligence_deals for select to authenticated
  using (fund_id = any(public.fund_ids_readable('diligence')));
create policy "diligence_deals insert needs diligence write"
  on public.diligence_deals for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "diligence_deals update needs diligence write"
  on public.diligence_deals for update to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')))
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "diligence_deals delete needs diligence write"
  on public.diligence_deals for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')));

create policy "diligence_documents read needs diligence"
  on public.diligence_documents for select to authenticated
  using (fund_id = any(public.fund_ids_readable('diligence')));
create policy "diligence_documents insert needs diligence write"
  on public.diligence_documents for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "diligence_documents update needs diligence write"
  on public.diligence_documents for update to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')))
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "diligence_documents delete needs diligence write"
  on public.diligence_documents for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')));

create policy "diligence_notes read needs diligence"
  on public.diligence_notes for select to authenticated
  using (fund_id = any(public.fund_ids_readable('diligence')));
create policy "diligence_notes insert needs diligence write"
  on public.diligence_notes for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "diligence_notes update needs diligence write"
  on public.diligence_notes for update to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')))
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "diligence_notes delete needs diligence write"
  on public.diligence_notes for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')));

create policy "diligence_memo_drafts read needs diligence"
  on public.diligence_memo_drafts for select to authenticated
  using (fund_id = any(public.fund_ids_readable('diligence')));
create policy "diligence_memo_drafts insert needs diligence write"
  on public.diligence_memo_drafts for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "diligence_memo_drafts update needs diligence write"
  on public.diligence_memo_drafts for update to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')))
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "diligence_memo_drafts delete needs diligence write"
  on public.diligence_memo_drafts for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')));

create policy "diligence_agent_sessions read needs diligence"
  on public.diligence_agent_sessions for select to authenticated
  using (fund_id = any(public.fund_ids_readable('diligence')));
create policy "diligence_agent_sessions insert needs diligence write"
  on public.diligence_agent_sessions for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "diligence_agent_sessions update needs diligence write"
  on public.diligence_agent_sessions for update to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')))
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "diligence_agent_sessions delete needs diligence write"
  on public.diligence_agent_sessions for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')));

create policy "diligence_attention_items read needs diligence"
  on public.diligence_attention_items for select to authenticated
  using (fund_id = any(public.fund_ids_readable('diligence')));
create policy "diligence_attention_items insert needs diligence write"
  on public.diligence_attention_items for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "diligence_attention_items update needs diligence write"
  on public.diligence_attention_items for update to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')))
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "diligence_attention_items delete needs diligence write"
  on public.diligence_attention_items for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')));

create policy "diligence_call_transcripts read needs diligence"
  on public.diligence_call_transcripts for select to authenticated
  using (fund_id = any(public.fund_ids_readable('diligence')));
create policy "diligence_call_transcripts insert needs diligence write"
  on public.diligence_call_transcripts for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "diligence_call_transcripts update needs diligence write"
  on public.diligence_call_transcripts for update to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')))
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "diligence_call_transcripts delete needs diligence write"
  on public.diligence_call_transcripts for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')));

create policy "diligence_checklist_items read needs diligence"
  on public.diligence_checklist_items for select to authenticated
  using (fund_id = any(public.fund_ids_readable('diligence')));
create policy "diligence_checklist_items insert needs diligence write"
  on public.diligence_checklist_items for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "diligence_checklist_items update needs diligence write"
  on public.diligence_checklist_items for update to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')))
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "diligence_checklist_items delete needs diligence write"
  on public.diligence_checklist_items for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')));

create policy "diligence_qa_chats read needs diligence"
  on public.diligence_qa_chats for select to authenticated
  using (fund_id = any(public.fund_ids_readable('diligence')));
create policy "diligence_qa_chats insert needs diligence write"
  on public.diligence_qa_chats for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "diligence_qa_chats update needs diligence write"
  on public.diligence_qa_chats for update to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')))
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "diligence_qa_chats delete needs diligence write"
  on public.diligence_qa_chats for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')));

create policy "firm_schemas read needs diligence"
  on public.firm_schemas for select to authenticated
  using (fund_id = any(public.fund_ids_readable('diligence')));
create policy "firm_schemas insert needs diligence write"
  on public.firm_schemas for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "firm_schemas update needs diligence write"
  on public.firm_schemas for update to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')))
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "firm_schemas delete needs diligence write"
  on public.firm_schemas for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')));

create policy "style_anchor_memos read needs diligence"
  on public.style_anchor_memos for select to authenticated
  using (fund_id = any(public.fund_ids_readable('diligence')));
create policy "style_anchor_memos insert needs diligence write"
  on public.style_anchor_memos for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "style_anchor_memos update needs diligence write"
  on public.style_anchor_memos for update to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')))
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "style_anchor_memos delete needs diligence write"
  on public.style_anchor_memos for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')));

create policy "memo_agent_prompts read needs diligence"
  on public.memo_agent_prompts for select to authenticated
  using (fund_id = any(public.fund_ids_readable('diligence')));
create policy "memo_agent_prompts insert needs diligence write"
  on public.memo_agent_prompts for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "memo_agent_prompts update needs diligence write"
  on public.memo_agent_prompts for update to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')))
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "memo_agent_prompts delete needs diligence write"
  on public.memo_agent_prompts for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')));

create policy "fund_memo_presets read needs diligence"
  on public.fund_memo_presets for select to authenticated
  using (fund_id = any(public.fund_ids_readable('diligence')));
create policy "fund_memo_presets insert needs diligence write"
  on public.fund_memo_presets for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "fund_memo_presets update needs diligence write"
  on public.fund_memo_presets for update to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')))
  with check (fund_id = any(public.fund_ids_writable('diligence')));
create policy "fund_memo_presets delete needs diligence write"
  on public.fund_memo_presets for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('diligence')));

-- ---- Fund accounting ---------------------------------------------------------------

create policy "chart_of_accounts read needs accounting"
  on public.chart_of_accounts for select to authenticated
  using (fund_id = any(public.fund_ids_readable('accounting')));
create policy "chart_of_accounts insert needs accounting write"
  on public.chart_of_accounts for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "chart_of_accounts update needs accounting write"
  on public.chart_of_accounts for update to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')))
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "chart_of_accounts delete needs accounting write"
  on public.chart_of_accounts for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')));

create policy "journal_entries read needs accounting"
  on public.journal_entries for select to authenticated
  using (fund_id = any(public.fund_ids_readable('accounting')));
create policy "journal_entries insert needs accounting write"
  on public.journal_entries for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "journal_entries update needs accounting write"
  on public.journal_entries for update to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')))
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "journal_entries delete needs accounting write"
  on public.journal_entries for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')));

create policy "journal_postings read needs accounting"
  on public.journal_postings for select to authenticated
  using (fund_id = any(public.fund_ids_readable('accounting')));
create policy "journal_postings insert needs accounting write"
  on public.journal_postings for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "journal_postings update needs accounting write"
  on public.journal_postings for update to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')))
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "journal_postings delete needs accounting write"
  on public.journal_postings for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')));

create policy "fiscal_periods read needs accounting"
  on public.fiscal_periods for select to authenticated
  using (fund_id = any(public.fund_ids_readable('accounting')));
create policy "fiscal_periods insert needs accounting write"
  on public.fiscal_periods for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "fiscal_periods update needs accounting write"
  on public.fiscal_periods for update to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')))
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "fiscal_periods delete needs accounting write"
  on public.fiscal_periods for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')));

create policy "bank_transactions read needs accounting"
  on public.bank_transactions for select to authenticated
  using (fund_id = any(public.fund_ids_readable('accounting')));
create policy "bank_transactions insert needs accounting write"
  on public.bank_transactions for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "bank_transactions update needs accounting write"
  on public.bank_transactions for update to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')))
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "bank_transactions delete needs accounting write"
  on public.bank_transactions for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')));

create policy "allocation_runs read needs accounting"
  on public.allocation_runs for select to authenticated
  using (fund_id = any(public.fund_ids_readable('accounting')));
create policy "allocation_runs insert needs accounting write"
  on public.allocation_runs for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "allocation_runs update needs accounting write"
  on public.allocation_runs for update to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')))
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "allocation_runs delete needs accounting write"
  on public.allocation_runs for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')));

create policy "allocation_results read needs accounting"
  on public.allocation_results for select to authenticated
  using (fund_id = any(public.fund_ids_readable('accounting')));
create policy "allocation_results insert needs accounting write"
  on public.allocation_results for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "allocation_results update needs accounting write"
  on public.allocation_results for update to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')))
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "allocation_results delete needs accounting write"
  on public.allocation_results for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')));

create policy "vehicle_accounting_settings read needs accounting"
  on public.vehicle_accounting_settings for select to authenticated
  using (fund_id = any(public.fund_ids_readable('accounting')));
create policy "vehicle_accounting_settings insert needs accounting write"
  on public.vehicle_accounting_settings for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "vehicle_accounting_settings update needs accounting write"
  on public.vehicle_accounting_settings for update to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')))
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "vehicle_accounting_settings delete needs accounting write"
  on public.vehicle_accounting_settings for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')));

create policy "qb_account_mappings read needs accounting"
  on public.qb_account_mappings for select to authenticated
  using (fund_id = any(public.fund_ids_readable('accounting')));
create policy "qb_account_mappings insert needs accounting write"
  on public.qb_account_mappings for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "qb_account_mappings update needs accounting write"
  on public.qb_account_mappings for update to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')))
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "qb_account_mappings delete needs accounting write"
  on public.qb_account_mappings for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')));

create policy "qb_import_runs read needs accounting"
  on public.qb_import_runs for select to authenticated
  using (fund_id = any(public.fund_ids_readable('accounting')));
create policy "qb_import_runs insert needs accounting write"
  on public.qb_import_runs for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "qb_import_runs update needs accounting write"
  on public.qb_import_runs for update to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')))
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "qb_import_runs delete needs accounting write"
  on public.qb_import_runs for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')));

create policy "fund_construction_models read needs accounting"
  on public.fund_construction_models for select to authenticated
  using (fund_id = any(public.fund_ids_readable('accounting')));
create policy "fund_construction_models insert needs accounting write"
  on public.fund_construction_models for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "fund_construction_models update needs accounting write"
  on public.fund_construction_models for update to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')))
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "fund_construction_models delete needs accounting write"
  on public.fund_construction_models for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')));

-- ---- LP capital --------------------------------------------------------------------

create policy "lp_entities read needs lp_capital"
  on public.lp_entities for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_capital')));
create policy "lp_entities insert needs lp_capital write"
  on public.lp_entities for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "lp_entities update needs lp_capital write"
  on public.lp_entities for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')))
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "lp_entities delete needs lp_capital write"
  on public.lp_entities for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')));

create policy "lp_investors read needs lp_capital"
  on public.lp_investors for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_capital')));
create policy "lp_investors insert needs lp_capital write"
  on public.lp_investors for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "lp_investors update needs lp_capital write"
  on public.lp_investors for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')))
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "lp_investors delete needs lp_capital write"
  on public.lp_investors for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')));

create policy "lp_investments read needs lp_capital"
  on public.lp_investments for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_capital')));
create policy "lp_investments insert needs lp_capital write"
  on public.lp_investments for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "lp_investments update needs lp_capital write"
  on public.lp_investments for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')))
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "lp_investments delete needs lp_capital write"
  on public.lp_investments for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')));

create policy "lp_snapshots read needs lp_capital"
  on public.lp_snapshots for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_capital')));
create policy "lp_snapshots insert needs lp_capital write"
  on public.lp_snapshots for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "lp_snapshots update needs lp_capital write"
  on public.lp_snapshots for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')))
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "lp_snapshots delete needs lp_capital write"
  on public.lp_snapshots for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')));

create policy "lp_positions read needs lp_capital"
  on public.lp_positions for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_capital', 'lp_tracking')));
create policy "lp_positions insert needs lp_capital write"
  on public.lp_positions for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_capital', 'lp_tracking')));
create policy "lp_positions update needs lp_capital write"
  on public.lp_positions for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital', 'lp_tracking')))
  with check (fund_id = any(public.fund_ids_writable('lp_capital', 'lp_tracking')));
create policy "lp_positions delete needs lp_capital write"
  on public.lp_positions for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital', 'lp_tracking')));

create policy "lp_capital_events read needs lp_capital"
  on public.lp_capital_events for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_capital')));
create policy "lp_capital_events insert needs lp_capital write"
  on public.lp_capital_events for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "lp_capital_events update needs lp_capital write"
  on public.lp_capital_events for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')))
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "lp_capital_events delete needs lp_capital write"
  on public.lp_capital_events for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')));

create policy "capital_calls read needs lp_capital"
  on public.capital_calls for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_capital')));
create policy "capital_calls insert needs lp_capital write"
  on public.capital_calls for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "capital_calls update needs lp_capital write"
  on public.capital_calls for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')))
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "capital_calls delete needs lp_capital write"
  on public.capital_calls for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')));

create policy "capital_call_lines read needs lp_capital"
  on public.capital_call_lines for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_capital')));
create policy "capital_call_lines insert needs lp_capital write"
  on public.capital_call_lines for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "capital_call_lines update needs lp_capital write"
  on public.capital_call_lines for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')))
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "capital_call_lines delete needs lp_capital write"
  on public.capital_call_lines for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')));

create policy "distributions read needs lp_capital"
  on public.distributions for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_capital')));
create policy "distributions insert needs lp_capital write"
  on public.distributions for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "distributions update needs lp_capital write"
  on public.distributions for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')))
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "distributions delete needs lp_capital write"
  on public.distributions for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')));

create policy "distribution_lines read needs lp_capital"
  on public.distribution_lines for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_capital')));
create policy "distribution_lines insert needs lp_capital write"
  on public.distribution_lines for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "distribution_lines update needs lp_capital write"
  on public.distribution_lines for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')))
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "distribution_lines delete needs lp_capital write"
  on public.distribution_lines for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')));

create policy "commitment_events read needs lp_capital"
  on public.commitment_events for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_capital')));
create policy "commitment_events insert needs lp_capital write"
  on public.commitment_events for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "commitment_events update needs lp_capital write"
  on public.commitment_events for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')))
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "commitment_events delete needs lp_capital write"
  on public.commitment_events for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')));

create policy "partner_allocation_terms read needs lp_capital"
  on public.partner_allocation_terms for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_capital')));
create policy "partner_allocation_terms insert needs lp_capital write"
  on public.partner_allocation_terms for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "partner_allocation_terms update needs lp_capital write"
  on public.partner_allocation_terms for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')))
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "partner_allocation_terms delete needs lp_capital write"
  on public.partner_allocation_terms for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')));

-- ---- GP economics ------------------------------------------------------------------

create policy "carry_payments read needs gp_economics"
  on public.carry_payments for select to authenticated
  using (fund_id = any(public.fund_ids_readable('gp_economics')));
create policy "carry_payments insert needs gp_economics write"
  on public.carry_payments for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('gp_economics')));
create policy "carry_payments update needs gp_economics write"
  on public.carry_payments for update to authenticated
  using (fund_id = any(public.fund_ids_writable('gp_economics')))
  with check (fund_id = any(public.fund_ids_writable('gp_economics')));
create policy "carry_payments delete needs gp_economics write"
  on public.carry_payments for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('gp_economics')));

create policy "vehicle_partner_ownership read needs gp_economics"
  on public.vehicle_partner_ownership for select to authenticated
  using (fund_id = any(public.fund_ids_readable('gp_economics')));
create policy "vehicle_partner_ownership insert needs gp_economics write"
  on public.vehicle_partner_ownership for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('gp_economics')));
create policy "vehicle_partner_ownership update needs gp_economics write"
  on public.vehicle_partner_ownership for update to authenticated
  using (fund_id = any(public.fund_ids_writable('gp_economics')))
  with check (fund_id = any(public.fund_ids_writable('gp_economics')));
create policy "vehicle_partner_ownership delete needs gp_economics write"
  on public.vehicle_partner_ownership for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('gp_economics')));

create policy "vehicle_gp_links read needs gp_economics"
  on public.vehicle_gp_links for select to authenticated
  using (fund_id = any(public.fund_ids_readable('gp_economics')));
create policy "vehicle_gp_links insert needs gp_economics write"
  on public.vehicle_gp_links for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('gp_economics')));
create policy "vehicle_gp_links update needs gp_economics write"
  on public.vehicle_gp_links for update to authenticated
  using (fund_id = any(public.fund_ids_writable('gp_economics')))
  with check (fund_id = any(public.fund_ids_writable('gp_economics')));
create policy "vehicle_gp_links delete needs gp_economics write"
  on public.vehicle_gp_links for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('gp_economics')));

create policy "vehicle_waterfall_terms read needs gp_economics"
  on public.vehicle_waterfall_terms for select to authenticated
  using (fund_id = any(public.fund_ids_readable('gp_economics')));
create policy "vehicle_waterfall_terms insert needs gp_economics write"
  on public.vehicle_waterfall_terms for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('gp_economics')));
create policy "vehicle_waterfall_terms update needs gp_economics write"
  on public.vehicle_waterfall_terms for update to authenticated
  using (fund_id = any(public.fund_ids_writable('gp_economics')))
  with check (fund_id = any(public.fund_ids_writable('gp_economics')));
create policy "vehicle_waterfall_terms delete needs gp_economics write"
  on public.vehicle_waterfall_terms for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('gp_economics')));

-- ---- LP relations ------------------------------------------------------------------

create policy "lp_letters read needs lp_relations"
  on public.lp_letters for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_relations', 'lp_letters')));
create policy "lp_letters insert needs lp_relations write"
  on public.lp_letters for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_letters')));
create policy "lp_letters update needs lp_relations write"
  on public.lp_letters for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_letters')))
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_letters')));
create policy "lp_letters delete needs lp_relations write"
  on public.lp_letters for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_letters')));

create policy "lp_letter_templates read needs lp_relations"
  on public.lp_letter_templates for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_relations', 'lp_letters')));
create policy "lp_letter_templates insert needs lp_relations write"
  on public.lp_letter_templates for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_letters')));
create policy "lp_letter_templates update needs lp_relations write"
  on public.lp_letter_templates for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_letters')))
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_letters')));
create policy "lp_letter_templates delete needs lp_relations write"
  on public.lp_letter_templates for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_letters')));

create policy "lp_letter_shares read needs lp_relations"
  on public.lp_letter_shares for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_relations', 'lp_letters')));
create policy "lp_letter_shares insert needs lp_relations write"
  on public.lp_letter_shares for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_letters')));
create policy "lp_letter_shares update needs lp_relations write"
  on public.lp_letter_shares for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_letters')))
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_letters')));
create policy "lp_letter_shares delete needs lp_relations write"
  on public.lp_letter_shares for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_letters')));

create policy "lp_documents read needs lp_relations"
  on public.lp_documents for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_relations', 'lp_portal')));
create policy "lp_documents insert needs lp_relations write"
  on public.lp_documents for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));
create policy "lp_documents update needs lp_relations write"
  on public.lp_documents for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')))
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));
create policy "lp_documents delete needs lp_relations write"
  on public.lp_documents for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));

create policy "lp_document_shares read needs lp_relations"
  on public.lp_document_shares for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_relations', 'lp_portal')));
create policy "lp_document_shares insert needs lp_relations write"
  on public.lp_document_shares for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));
create policy "lp_document_shares update needs lp_relations write"
  on public.lp_document_shares for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')))
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));
create policy "lp_document_shares delete needs lp_relations write"
  on public.lp_document_shares for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));

create policy "lp_snapshot_shares read needs lp_relations"
  on public.lp_snapshot_shares for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_relations', 'lp_portal')));
create policy "lp_snapshot_shares insert needs lp_relations write"
  on public.lp_snapshot_shares for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));
create policy "lp_snapshot_shares update needs lp_relations write"
  on public.lp_snapshot_shares for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')))
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));
create policy "lp_snapshot_shares delete needs lp_relations write"
  on public.lp_snapshot_shares for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));

create policy "lp_live_report_shares read needs lp_relations"
  on public.lp_live_report_shares for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_relations', 'lp_portal')));
create policy "lp_live_report_shares insert needs lp_relations write"
  on public.lp_live_report_shares for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));
create policy "lp_live_report_shares update needs lp_relations write"
  on public.lp_live_report_shares for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')))
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));
create policy "lp_live_report_shares delete needs lp_relations write"
  on public.lp_live_report_shares for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));

create policy "lp_messages read needs lp_relations"
  on public.lp_messages for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_relations', 'lp_portal')));
create policy "lp_messages insert needs lp_relations write"
  on public.lp_messages for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));
create policy "lp_messages update needs lp_relations write"
  on public.lp_messages for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')))
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));
create policy "lp_messages delete needs lp_relations write"
  on public.lp_messages for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));

create policy "lp_access_events read needs lp_relations"
  on public.lp_access_events for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_relations', 'lp_activity')));
create policy "lp_access_events insert needs lp_relations write"
  on public.lp_access_events for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_activity')));
create policy "lp_access_events update needs lp_relations write"
  on public.lp_access_events for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_activity')))
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_activity')));
create policy "lp_access_events delete needs lp_relations write"
  on public.lp_access_events for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_activity')));

-- ---- Compliance --------------------------------------------------------------------

create policy "compliance_filings read needs compliance"
  on public.compliance_filings for select to authenticated
  using (fund_id = any(public.fund_ids_readable('compliance')));
create policy "compliance_filings insert needs compliance write"
  on public.compliance_filings for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('compliance')));
create policy "compliance_filings update needs compliance write"
  on public.compliance_filings for update to authenticated
  using (fund_id = any(public.fund_ids_writable('compliance')))
  with check (fund_id = any(public.fund_ids_writable('compliance')));
create policy "compliance_filings delete needs compliance write"
  on public.compliance_filings for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('compliance')));

create policy "compliance_deadlines read needs compliance"
  on public.compliance_deadlines for select to authenticated
  using (fund_id = any(public.fund_ids_readable('compliance')));
create policy "compliance_deadlines insert needs compliance write"
  on public.compliance_deadlines for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('compliance')));
create policy "compliance_deadlines update needs compliance write"
  on public.compliance_deadlines for update to authenticated
  using (fund_id = any(public.fund_ids_writable('compliance')))
  with check (fund_id = any(public.fund_ids_writable('compliance')));
create policy "compliance_deadlines delete needs compliance write"
  on public.compliance_deadlines for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('compliance')));

create policy "compliance_links read needs compliance"
  on public.compliance_links for select to authenticated
  using (fund_id = any(public.fund_ids_readable('compliance')));
create policy "compliance_links insert needs compliance write"
  on public.compliance_links for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('compliance')));
create policy "compliance_links update needs compliance write"
  on public.compliance_links for update to authenticated
  using (fund_id = any(public.fund_ids_writable('compliance')))
  with check (fund_id = any(public.fund_ids_writable('compliance')));
create policy "compliance_links delete needs compliance write"
  on public.compliance_links for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('compliance')));

create policy "compliance_fund_settings read needs compliance"
  on public.compliance_fund_settings for select to authenticated
  using (fund_id = any(public.fund_ids_readable('compliance')));
create policy "compliance_fund_settings insert needs compliance write"
  on public.compliance_fund_settings for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('compliance')));
create policy "compliance_fund_settings update needs compliance write"
  on public.compliance_fund_settings for update to authenticated
  using (fund_id = any(public.fund_ids_writable('compliance')))
  with check (fund_id = any(public.fund_ids_writable('compliance')));
create policy "compliance_fund_settings delete needs compliance write"
  on public.compliance_fund_settings for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('compliance')));

create policy "fund_compliance_profile read needs compliance"
  on public.fund_compliance_profile for select to authenticated
  using (fund_id = any(public.fund_ids_readable('compliance')));
create policy "fund_compliance_profile insert needs compliance write"
  on public.fund_compliance_profile for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('compliance')));
create policy "fund_compliance_profile update needs compliance write"
  on public.fund_compliance_profile for update to authenticated
  using (fund_id = any(public.fund_ids_writable('compliance')))
  with check (fund_id = any(public.fund_ids_writable('compliance')));
create policy "fund_compliance_profile delete needs compliance write"
  on public.fund_compliance_profile for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('compliance')));

-- ---- Administration ----------------------------------------------------------------

create policy "authorized_senders read needs admin"
  on public.authorized_senders for select to authenticated
  using (fund_id = any(public.fund_ids_readable('admin')));
create policy "authorized_senders insert needs admin write"
  on public.authorized_senders for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('admin')));
create policy "authorized_senders update needs admin write"
  on public.authorized_senders for update to authenticated
  using (fund_id = any(public.fund_ids_writable('admin')))
  with check (fund_id = any(public.fund_ids_writable('admin')));
create policy "authorized_senders delete needs admin write"
  on public.authorized_senders for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('admin')));

create policy "ai_usage_logs read needs admin"
  on public.ai_usage_logs for select to authenticated
  using (fund_id = any(public.fund_ids_readable('admin')));
create policy "ai_usage_logs insert needs admin write"
  on public.ai_usage_logs for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('admin')));
create policy "ai_usage_logs update needs admin write"
  on public.ai_usage_logs for update to authenticated
  using (fund_id = any(public.fund_ids_writable('admin')))
  with check (fund_id = any(public.fund_ids_writable('admin')));
create policy "ai_usage_logs delete needs admin write"
  on public.ai_usage_logs for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('admin')));

create policy "user_activity_logs read needs admin"
  on public.user_activity_logs for select to authenticated
  using (fund_id = any(public.fund_ids_readable('admin')));
create policy "user_activity_logs insert needs admin write"
  on public.user_activity_logs for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('admin')));
create policy "user_activity_logs update needs admin write"
  on public.user_activity_logs for update to authenticated
  using (fund_id = any(public.fund_ids_writable('admin')))
  with check (fund_id = any(public.fund_ids_writable('admin')));
create policy "user_activity_logs delete needs admin write"
  on public.user_activity_logs for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('admin')));

-- ---- Reached through a parent row that carries the fund ------------------------------------

create policy "compliance_workflows read needs compliance"
  on public.compliance_workflows for select to authenticated
  using (exists (
    select 1 from public.compliance_deadlines parent
     where parent.id = compliance_workflows.deadline_id
       and parent.fund_id = any(public.fund_ids_readable('compliance'))));
create policy "compliance_workflows write needs compliance write"
  on public.compliance_workflows for all to authenticated
  using (exists (
    select 1 from public.compliance_deadlines parent
     where parent.id = compliance_workflows.deadline_id
       and parent.fund_id = any(public.fund_ids_writable('compliance'))))
  with check (exists (
    select 1 from public.compliance_deadlines parent
     where parent.id = compliance_workflows.deadline_id
       and parent.fund_id = any(public.fund_ids_writable('compliance'))));

create policy "compliance_entry_data read needs compliance"
  on public.compliance_entry_data for select to authenticated
  using (exists (
    select 1 from public.compliance_deadlines parent
     where parent.id = compliance_entry_data.deadline_id
       and parent.fund_id = any(public.fund_ids_readable('compliance'))));
create policy "compliance_entry_data write needs compliance write"
  on public.compliance_entry_data for all to authenticated
  using (exists (
    select 1 from public.compliance_deadlines parent
     where parent.id = compliance_entry_data.deadline_id
       and parent.fund_id = any(public.fund_ids_writable('compliance'))))
  with check (exists (
    select 1 from public.compliance_deadlines parent
     where parent.id = compliance_entry_data.deadline_id
       and parent.fund_id = any(public.fund_ids_writable('compliance'))));

-- ============================================================================================
-- 5. Owner-private rows.
--
-- Fund membership is not enough: the row belongs to one person. This is the conversation fix —
-- an Analyst conversation's summary is replayed into a later system prompt, so a colleague able to
-- write your conversation could write your prompt.
-- ============================================================================================

create policy "note_company_subscriptions is private to its owner"
  on public.note_company_subscriptions for all to authenticated
  using (fund_id = any(public.get_my_fund_ids()) and user_id = auth.uid())
  with check (fund_id = any(public.get_my_fund_ids()) and user_id = auth.uid());

create policy "note_notification_preferences is private to its owner"
  on public.note_notification_preferences for all to authenticated
  using (fund_id = any(public.get_my_fund_ids()) and user_id = auth.uid())
  with check (fund_id = any(public.get_my_fund_ids()) and user_id = auth.uid());

create policy "note_reads is private to its owner"
  on public.note_reads for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "analyst_conversations is private to its owner"
  on public.analyst_conversations for all to authenticated
  using (fund_id = any(public.get_my_fund_ids()) and user_id = auth.uid())
  with check (fund_id = any(public.get_my_fund_ids()) and user_id = auth.uid());

-- ============================================================================================
-- 6. Read by any member, written by admins.
--
-- The app itself reads these with the USER-context client before it knows anything about grants:
-- the feature map decides the nav, and two server pages select it directly. Gating them by domain
-- would be circular.
-- ============================================================================================

create policy "fund_settings readable by fund members"
  on public.fund_settings for select to authenticated
  using (fund_id = any(public.get_my_fund_ids()));
create policy "fund_settings written by fund admins"
  on public.fund_settings for all to authenticated
  using (public.is_fund_admin(fund_id))
  with check (public.is_fund_admin(fund_id));

create policy "fund_vehicles readable by fund members"
  on public.fund_vehicles for select to authenticated
  using (fund_id = any(public.get_my_fund_ids()));
create policy "fund_vehicles written by fund admins"
  on public.fund_vehicles for all to authenticated
  using (public.is_fund_admin(fund_id))
  with check (public.is_fund_admin(fund_id));

-- ============================================================================================
-- 7. Rows that name their own domain.
--
-- A staged write carries the domain it would perform. Staging one needs read there; approving it
-- (an update to 'approved') needs write there. Without this, a member holding only `portfolio`
-- could list — and approve — an accounting action.
-- ============================================================================================

create policy "pending_actions read needs read in the row's domain"
  on public.pending_actions for select to authenticated
  using (public.can_read_domain(fund_id, domain));
create policy "pending_actions staged by anyone who can read the domain"
  on public.pending_actions for insert to authenticated
  with check (public.can_read_domain(fund_id, domain));
create policy "pending_actions approved only with write in the domain"
  on public.pending_actions for update to authenticated
  using (public.can_write_domain(fund_id, domain))
  with check (public.can_write_domain(fund_id, domain));
create policy "pending_actions delete needs write in the domain"
  on public.pending_actions for delete to authenticated
  using (public.can_write_domain(fund_id, domain));

-- ============================================================================================
-- 8. Not reachable through the Data API at all.
--
-- Credentials, token material and infrastructure counters. RLS with no policy already denies, but
-- the grants are removed too: PostgREST should not be able to name these relations, and a future
-- migration that adds a well-meaning policy should not be enough to expose them.
-- ============================================================================================
revoke all on public.fund_api_keys from anon, authenticated;
grant select, insert, update, delete on public.fund_api_keys to service_role;
revoke all on public.affinity_credentials from anon, authenticated;
grant select, insert, update, delete on public.affinity_credentials to service_role;
revoke all on public.oauth_clients from anon, authenticated;
grant select, insert, update, delete on public.oauth_clients to service_role;
revoke all on public.oauth_tokens from anon, authenticated;
grant select, insert, update, delete on public.oauth_tokens to service_role;
revoke all on public.oauth_authorization_codes from anon, authenticated;
grant select, insert, update, delete on public.oauth_authorization_codes to service_role;
revoke all on public.app_settings from anon, authenticated;
grant select, insert, update, delete on public.app_settings to service_role;
revoke all on public.allowed_signups from anon, authenticated;
grant select, insert, update, delete on public.allowed_signups to service_role;
revoke all on public.rate_limit_entries from anon, authenticated;
grant select, insert, update, delete on public.rate_limit_entries to service_role;
revoke all on public.demo_sessions from anon, authenticated;
grant select, insert, update, delete on public.demo_sessions to service_role;
revoke all on public.memo_agent_jobs from anon, authenticated;
grant select, insert, update, delete on public.memo_agent_jobs to service_role;

-- ============================================================================================
-- 9. Global reference data and the one deliberately public table.
-- ============================================================================================

revoke all on public.compliance_items from anon;
grant select on public.compliance_items to authenticated;
grant select, insert, update, delete on public.compliance_items to service_role;
create policy "compliance_items is reference data for signed-in users"
  on public.compliance_items for select to authenticated using (true);

grant select on public.site_content to anon, authenticated;
grant select, insert, update, delete on public.site_content to service_role;
create policy "site_content is world readable"
  on public.site_content for select to anon, authenticated using (true);

-- ============================================================================================
-- 10. Anonymous access to the domain-gated tables.
--
-- Every policy above is `to authenticated`, so `anon` already resolves to nothing. Dropping the
-- privilege as well means the next person to add a permissive policy does not accidentally hand
-- the public anon key a table.
-- ============================================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'companies', 'company_documents', 'company_summaries', 'metrics',
    'metric_values', 'default_metrics', 'default_metric_exclusions', 'parsing_reviews',
    'ask_response_overrides', 'investment_transactions', 'crypto_wallets', 'crypto_wallet_balances',
    'price_feeds', 'price_observations', 'fund_group_config', 'fund_cash_flows',
    'fund_capital_events', 'fund_holding_terms', 'fund_nav_statements', 'interactions',
    'company_notes', 'note_company_subscriptions', 'note_notification_preferences', 'note_reads',
    'inbound_deals', 'known_referrers', 'routing_corrections', 'inbound_emails',
    'email_requests', 'diligence_deals', 'diligence_documents', 'diligence_notes',
    'diligence_memo_drafts', 'diligence_agent_sessions', 'diligence_attention_items', 'diligence_call_transcripts',
    'diligence_checklist_items', 'diligence_qa_chats', 'firm_schemas', 'style_anchor_memos',
    'memo_agent_prompts', 'fund_memo_presets', 'chart_of_accounts', 'journal_entries',
    'journal_postings', 'fiscal_periods', 'bank_transactions', 'allocation_runs',
    'allocation_results', 'vehicle_accounting_settings', 'qb_account_mappings', 'qb_import_runs',
    'fund_construction_models', 'lp_entities', 'lp_investors', 'lp_investments',
    'lp_snapshots', 'lp_positions', 'lp_capital_events', 'capital_calls',
    'capital_call_lines', 'distributions', 'distribution_lines', 'commitment_events',
    'partner_allocation_terms', 'carry_payments', 'vehicle_partner_ownership', 'vehicle_gp_links',
    'vehicle_waterfall_terms', 'lp_letters', 'lp_letter_templates', 'lp_letter_shares',
    'lp_documents', 'lp_document_shares', 'lp_snapshot_shares', 'lp_live_report_shares',
    'lp_messages', 'lp_access_events', 'compliance_filings', 'compliance_deadlines',
    'compliance_links', 'compliance_fund_settings', 'fund_compliance_profile', 'compliance_workflows',
    'compliance_entry_data', 'authorized_senders', 'ai_usage_logs', 'user_activity_logs',
    'fund_settings', 'fund_vehicles', 'pending_actions', 'analyst_conversations'
  ] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated, service_role', t);
  end loop;
end $$;

-- ============================================================================================
-- 11. Storage.
--
-- The buckets carried the same weakness as the tables: any member of the owning fund could read
-- every object. The folder conventions differ per bucket and are preserved —
-- company-documents/{fundId}/…, style-anchor-memos/{fundId}/…, lp-documents/{fundId}/…,
-- email-attachments/{emailId}/…, diligence-{documents,recordings}/{dealId}/….
-- ============================================================================================

do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and coalesce(qual, '') || coalesce(with_check, '') like any (array[
         '%company-documents%', '%email-attachments%', '%diligence-documents%',
         '%style-anchor-memos%', '%diligence-recordings%', '%lp-documents%'])
  loop
    execute format('drop policy if exists %I on storage.objects', p.policyname);
  end loop;
end $$;

-- company-documents — folder is the fund id.
create policy "company-documents read needs portfolio"
  on storage.objects for select to authenticated
  using (bucket_id = 'company-documents'
     and (storage.foldername(name))[1]::uuid = any(public.fund_ids_readable('portfolio')));
create policy "company-documents write needs portfolio write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'company-documents'
     and (storage.foldername(name))[1]::uuid = any(public.fund_ids_writable('portfolio')));
create policy "company-documents delete needs portfolio write"
  on storage.objects for delete to authenticated
  using (bucket_id = 'company-documents'
     and (storage.foldername(name))[1]::uuid = any(public.fund_ids_writable('portfolio')));

-- email-attachments — folder is the inbound email id.
create policy "email-attachments read needs dealflow"
  on storage.objects for select to authenticated
  using (bucket_id = 'email-attachments' and exists (
    select 1 from public.inbound_emails ie
     where ie.id = (storage.foldername(name))[1]::uuid
       and ie.fund_id = any(public.fund_ids_readable('dealflow'))));
create policy "email-attachments write needs dealflow write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'email-attachments' and exists (
    select 1 from public.inbound_emails ie
     where ie.id = (storage.foldername(name))[1]::uuid
       and ie.fund_id = any(public.fund_ids_writable('dealflow'))));
create policy "email-attachments delete needs dealflow write"
  on storage.objects for delete to authenticated
  using (bucket_id = 'email-attachments' and exists (
    select 1 from public.inbound_emails ie
     where ie.id = (storage.foldername(name))[1]::uuid
       and ie.fund_id = any(public.fund_ids_writable('dealflow'))));

-- diligence-documents and diligence-recordings — folder is the deal id.
create policy "diligence-documents read needs diligence"
  on storage.objects for select to authenticated
  using (bucket_id = 'diligence-documents' and exists (
    select 1 from public.diligence_deals d
     where d.id = (storage.foldername(name))[1]::uuid
       and d.fund_id = any(public.fund_ids_readable('diligence'))));
create policy "diligence-documents write needs diligence write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'diligence-documents' and exists (
    select 1 from public.diligence_deals d
     where d.id = (storage.foldername(name))[1]::uuid
       and d.fund_id = any(public.fund_ids_writable('diligence'))));
create policy "diligence-documents update needs diligence write"
  on storage.objects for update to authenticated
  using (bucket_id = 'diligence-documents' and exists (
    select 1 from public.diligence_deals d
     where d.id = (storage.foldername(name))[1]::uuid
       and d.fund_id = any(public.fund_ids_writable('diligence'))))
  with check (bucket_id = 'diligence-documents' and exists (
    select 1 from public.diligence_deals d
     where d.id = (storage.foldername(name))[1]::uuid
       and d.fund_id = any(public.fund_ids_writable('diligence'))));
create policy "diligence-documents delete needs diligence write"
  on storage.objects for delete to authenticated
  using (bucket_id = 'diligence-documents' and exists (
    select 1 from public.diligence_deals d
     where d.id = (storage.foldername(name))[1]::uuid
       and d.fund_id = any(public.fund_ids_writable('diligence'))));

create policy "diligence-recordings read needs diligence"
  on storage.objects for select to authenticated
  using (bucket_id = 'diligence-recordings' and exists (
    select 1 from public.diligence_deals d
     where d.id = (storage.foldername(name))[1]::uuid
       and d.fund_id = any(public.fund_ids_readable('diligence'))));
create policy "diligence-recordings write needs diligence write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'diligence-recordings' and exists (
    select 1 from public.diligence_deals d
     where d.id = (storage.foldername(name))[1]::uuid
       and d.fund_id = any(public.fund_ids_writable('diligence'))));
create policy "diligence-recordings delete needs diligence write"
  on storage.objects for delete to authenticated
  using (bucket_id = 'diligence-recordings' and exists (
    select 1 from public.diligence_deals d
     where d.id = (storage.foldername(name))[1]::uuid
       and d.fund_id = any(public.fund_ids_writable('diligence'))));

-- style-anchor-memos — folder is the fund id. The house voice for generated memos: diligence.
create policy "style-anchor-memos read needs diligence"
  on storage.objects for select to authenticated
  using (bucket_id = 'style-anchor-memos'
     and (storage.foldername(name))[1]::uuid = any(public.fund_ids_readable('diligence')));
create policy "style-anchor-memos write needs diligence write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'style-anchor-memos'
     and (storage.foldername(name))[1]::uuid = any(public.fund_ids_writable('diligence')));
create policy "style-anchor-memos delete needs diligence write"
  on storage.objects for delete to authenticated
  using (bucket_id = 'style-anchor-memos'
     and (storage.foldername(name))[1]::uuid = any(public.fund_ids_writable('diligence')));

-- lp-documents — folder is the fund id. LP portal readers never come through here: the portal
-- resolves documents with the service role and hands out signed URLs, so these policies govern
-- the GP side only.
create policy "lp-documents read needs lp_relations"
  on storage.objects for select to authenticated
  using (bucket_id = 'lp-documents'
     and (storage.foldername(name))[1]::uuid = any(public.fund_ids_readable('lp_relations', 'lp_portal')));
create policy "lp-documents write needs lp_relations write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'lp-documents'
     and (storage.foldername(name))[1]::uuid = any(public.fund_ids_writable('lp_relations', 'lp_portal')));
create policy "lp-documents delete needs lp_relations write"
  on storage.objects for delete to authenticated
  using (bucket_id = 'lp-documents'
     and (storage.foldername(name))[1]::uuid = any(public.fund_ids_writable('lp_relations', 'lp_portal')));

-- ============================================================================================
-- 12. is_fund_writer is no longer the answer to anything.
--
-- Left in place because older migrations reference it and dropping it would break a replay from
-- zero, but nothing this migration creates calls it. "Any member who is not a viewer may write
-- everything" is the assumption SEC-002 exists to remove.
-- ============================================================================================

comment on function public.is_fund_writer(uuid) is
  'DEPRECATED (SEC-002): treats every member as a writer in every domain. Use public.fund_ids_writable(domain) or public.can_write_domain(fund_id, domain).';
