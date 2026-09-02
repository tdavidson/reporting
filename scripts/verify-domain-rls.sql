-- Does the SEC-002 policy set actually do what it says?
--
-- Paste this WHOLE file into the Supabase SQL editor and run it in one go.
--
-- It reports through a SINGLE result set at the bottom. That is deliberate: the SQL editor shows
-- only the last statement's grid, so an earlier `select` is run and then thrown away. Every probe
-- below stashes its answer in a transaction-local setting and the final query assembles them.
--
-- IT IS NOT READ-ONLY. Section 5 narrows the probe user's role and grants so the policies have
-- something to actually refuse — without that, a fund whose defaults are 'write' on every domain
-- reads identically before and after SEC-002, and this would prove nothing. Those writes are
-- inside the transaction that ROLLBACKs at the bottom, so nothing lands. Run all of it or none of
-- it: stopping partway would leave that member really demoted.
--
-- Why a human has to run it: the policies key off auth.uid(), which is null for the service role.
-- No test in CI can answer this; only a session that can set request.jwt.claims can.

begin;

-- ------------------------------------------------------------------------------------------
-- Pick a probe user. A plain member is the interesting case — an admin resolves to 'write'
-- everywhere by role and would prove nothing about grants.
-- ------------------------------------------------------------------------------------------
select set_config('probe.user_id', m.user_id::text, true),
       set_config('probe.fund_id', m.fund_id::text, true),
       set_config('probe.role', m.role, true)
  from fund_members m
 order by (m.role = 'member') desc, (m.role = 'viewer') desc, m.user_id
 limit 1;

-- The true counts, taken as the service role before impersonating. Held in a setting rather than
-- a temp table: a temp table is owned by postgres and becomes unreadable the moment this session
-- becomes `authenticated`.
select set_config('probe.truth', (
  select jsonb_object_agg(tbl, total)::text from (
    select 'companies' as tbl, count(*) as total from companies where fund_id = current_setting('probe.fund_id')::uuid
    union all select 'metrics', count(*) from metrics where fund_id = current_setting('probe.fund_id')::uuid
    union all select 'journal_entries', count(*) from journal_entries where fund_id = current_setting('probe.fund_id')::uuid
    union all select 'chart_of_accounts', count(*) from chart_of_accounts where fund_id = current_setting('probe.fund_id')::uuid
    union all select 'lp_investors', count(*) from lp_investors where fund_id = current_setting('probe.fund_id')::uuid
    union all select 'carry_payments', count(*) from carry_payments where fund_id = current_setting('probe.fund_id')::uuid
    union all select 'vehicle_partner_ownership', count(*) from vehicle_partner_ownership where fund_id = current_setting('probe.fund_id')::uuid
    union all select 'diligence_deals', count(*) from diligence_deals where fund_id = current_setting('probe.fund_id')::uuid
    union all select 'lp_documents', count(*) from lp_documents where fund_id = current_setting('probe.fund_id')::uuid
    union all select 'inbound_emails', count(*) from inbound_emails where fund_id = current_setting('probe.fund_id')::uuid
    union all select 'fund_construction_models', count(*) from fund_construction_models where fund_id = current_setting('probe.fund_id')::uuid
    union all select 'pending_actions', count(*) from pending_actions where fund_id = current_setting('probe.fund_id')::uuid
    union all select 'analyst_conversations', count(*) from analyst_conversations where fund_id = current_setting('probe.fund_id')::uuid
    union all select 'parsing_reviews', count(*) from parsing_reviews where fund_id = current_setting('probe.fund_id')::uuid
    union all select 'email_requests', count(*) from email_requests where fund_id = current_setting('probe.fund_id')::uuid
    union all select 'crypto_wallets', count(*) from crypto_wallets where fund_id = current_setting('probe.fund_id')::uuid
    union all select 'price_feeds', count(*) from price_feeds where fund_id = current_setting('probe.fund_id')::uuid
    union all select 'fund_settings', count(*) from fund_settings where fund_id = current_setting('probe.fund_id')::uuid
  ) counts
), true);

-- 1. Who is being impersonated, and what the fund's own switches and defaults say.
select set_config('probe.who', jsonb_build_object(
  'user_id', current_setting('probe.user_id'),
  'fund_role', current_setting('probe.role'),
  'explicit_grants', (select count(*) from fund_member_access
                       where user_id = current_setting('probe.user_id')::uuid),
  'fund_defaults', (select jsonb_object_agg(domain, level)::text from fund_domain_defaults
                     where fund_id = current_setting('probe.fund_id')::uuid),
  'feature_switches', (select feature_visibility::text from fund_settings
                        where fund_id = current_setting('probe.fund_id')::uuid)
)::text, true);

-- ------------------------------------------------------------------------------------------
-- Become that member. Everything below runs under their JWT and their RLS.
-- ------------------------------------------------------------------------------------------
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('probe.user_id'),
                                    'role', 'authenticated')::text, true);
set local role authenticated;

-- 2. What domain_access() resolves for them, as they are today.
select set_config('probe.resolved', (
  select jsonb_object_agg(d, public.domain_access(current_setting('probe.fund_id')::uuid, d))::text
    from unnest(array['portfolio','relationships','dealflow','diligence','accounting',
                      'lp_capital','gp_economics','lp_relations','compliance','admin']) as d
), true);

-- 3. What they can actually SELECT, as they are today. Compared against probe.truth, this is the
--    over-denial check: a domain they hold must return every row, or a page goes blank.
select set_config('probe.visible', (
  select jsonb_object_agg(tbl, visible)::text from (
    select 'companies' as tbl, count(*) as visible from companies
    union all select 'metrics', count(*) from metrics
    union all select 'journal_entries', count(*) from journal_entries
    union all select 'chart_of_accounts', count(*) from chart_of_accounts
    union all select 'lp_investors', count(*) from lp_investors
    union all select 'carry_payments', count(*) from carry_payments
    union all select 'vehicle_partner_ownership', count(*) from vehicle_partner_ownership
    union all select 'diligence_deals', count(*) from diligence_deals
    union all select 'lp_documents', count(*) from lp_documents
    union all select 'inbound_emails', count(*) from inbound_emails
    union all select 'fund_construction_models', count(*) from fund_construction_models
    union all select 'pending_actions', count(*) from pending_actions
    union all select 'analyst_conversations', count(*) from analyst_conversations
    union all select 'parsing_reviews', count(*) from parsing_reviews
    union all select 'email_requests', count(*) from email_requests
    union all select 'crypto_wallets', count(*) from crypto_wallets
    union all select 'price_feeds', count(*) from price_feeds
    union all select 'fund_settings', count(*) from fund_settings
  ) seen
), true);

-- 4. The only four places the app still reads tables with the USER-context client. If SEC-002
--    broke anything for a real user it broke it here, and these pages render nothing:
--    app/(app)/layout.tsx, companies/[id]/page.tsx, emails/[id]/page.tsx, api/review/route.ts.
select set_config('probe.live', jsonb_build_object(
  'layout: funds',              (select count(*) from funds),
  'company page: fund_settings',(select count(*) from fund_settings),
  'company page: companies',    (select count(*) from companies),
  'company page: metrics',      (select count(*) from metrics),
  'company page: metric_values',(select count(*) from metric_values),
  'email page: inbound_emails', (select count(*) from inbound_emails),
  'review: parsing_reviews',    (select count(*) from parsing_reviews)
)::text, true);

-- ------------------------------------------------------------------------------------------
-- 5. Narrow them to portfolio-only and look again. THIS is the finding: a member of the fund,
--    holding a valid JWT, talking straight to PostgREST, and not getting the carry table.
--    Rolled back at the bottom.
-- ------------------------------------------------------------------------------------------
reset role;

update fund_members set role = 'member'
 where user_id = current_setting('probe.user_id')::uuid;

delete from fund_member_access
 where user_id = current_setting('probe.user_id')::uuid;

insert into fund_member_access (fund_id, user_id, domain, level)
select current_setting('probe.fund_id')::uuid, current_setting('probe.user_id')::uuid, d,
       case when d = 'portfolio' then 'read' else 'none' end
  from unnest(array['portfolio','relationships','dealflow','diligence','accounting',
                    'lp_capital','gp_economics','lp_relations','compliance']) as d;

set local role authenticated;

select set_config('probe.narrowed', (
  select jsonb_object_agg(tbl, visible)::text from (
    select 'companies' as tbl, count(*) as visible from companies
    union all select 'metrics', count(*) from metrics
    union all select 'journal_entries', count(*) from journal_entries
    union all select 'chart_of_accounts', count(*) from chart_of_accounts
    union all select 'lp_investors', count(*) from lp_investors
    union all select 'carry_payments', count(*) from carry_payments
    union all select 'vehicle_partner_ownership', count(*) from vehicle_partner_ownership
    union all select 'diligence_deals', count(*) from diligence_deals
    union all select 'lp_documents', count(*) from lp_documents
    union all select 'inbound_emails', count(*) from inbound_emails
    union all select 'parsing_reviews', count(*) from parsing_reviews
    union all select 'email_requests', count(*) from email_requests
    union all select 'crypto_wallets', count(*) from crypto_wallets
    union all select 'price_feeds', count(*) from price_feeds
    union all select 'fund_construction_models', count(*) from fund_construction_models
  ) seen
), true);

-- A read-only portfolio grant must not be able to write the domain it can read.
do $$
begin
  begin
    insert into companies (fund_id, name)
    values (current_setting('probe.fund_id')::uuid, '__rls_probe__');
    perform set_config('probe.write', 'FAILED — a read-only portfolio grant inserted a company', true);
  exception
    when insufficient_privilege then
      perform set_config('probe.write', 'passed — insert refused by RLS', true);
    when others then
      -- Anything else means the probe never reached the policy, so it proved nothing.
      perform set_config('probe.write', 'INCONCLUSIVE — failed for another reason: ' || sqlerrm, true);
  end;
end $$;

-- 6. The credential and infrastructure tables must not be selectable at all.
do $$
declare t text; leaked text[] := array[]::text[]; n bigint;
begin
  foreach t in array array['oauth_tokens','fund_api_keys','api_idempotency_keys',
                           'affinity_credentials','rate_limit_entries','allowed_signups'] loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      leaked := leaked || t;
    exception when insufficient_privilege then
      null;  -- what we want: not selectable
    end;
  end loop;
  perform set_config('probe.service',
    case when array_length(leaked, 1) > 0
         then 'FAILED — still selectable: ' || array_to_string(leaked, ', ')
         else 'passed — none selectable by authenticated' end, true);
end $$;

reset role;

-- ------------------------------------------------------------------------------------------
-- THE REPORT. One result set, because the editor only shows the last one.
-- ------------------------------------------------------------------------------------------
with domains(tbl, domain) as (values
  ('companies','portfolio'), ('metrics','portfolio'),
  ('journal_entries','accounting'), ('chart_of_accounts','accounting'),
  ('fund_construction_models','accounting'),
  ('lp_investors','lp_capital'), ('carry_payments','gp_economics'),
  ('vehicle_partner_ownership','gp_economics'), ('diligence_deals','diligence'),
  -- The mailbox is portfolio INTAKE, not deal flow. This row said 'dealflow' after the table had
  -- already moved, which reported a correct result as UNEXPECTED — the map has to track the
  -- registry or the verdict column lies.
  ('lp_documents','lp_relations'), ('inbound_emails','portfolio'),
  ('parsing_reviews','portfolio'), ('email_requests','portfolio'),
  ('crypto_wallets','accounting'), ('price_feeds','accounting'),
  ('pending_actions','per-row'), ('analyst_conversations','owner-only'),
  ('fund_settings','any member')
)
select * from (
  select 1 as sort, '1. WHO' as section, k as item, v as detail, '' as verdict
    from jsonb_each_text(current_setting('probe.who')::jsonb) as e(k, v)

  union all
  select 2, '2. RESOLVED (as they are)', k, v, ''
    from jsonb_each_text(current_setting('probe.resolved')::jsonb) as e(k, v)

  union all
  select 3, '3. VISIBLE (as they are)', d.tbl || '  [' || d.domain || ']',
         (current_setting('probe.visible')::jsonb ->> d.tbl) || ' of ' ||
         (current_setting('probe.truth')::jsonb ->> d.tbl),
         case
           when (current_setting('probe.truth')::jsonb ->> d.tbl)::bigint = 0 then 'no data'
           when (current_setting('probe.visible')::jsonb ->> d.tbl)::bigint = 0 then 'BLOCKED'
           when (current_setting('probe.visible')::jsonb ->> d.tbl)
              = (current_setting('probe.truth')::jsonb ->> d.tbl) then 'FULL'
           -- Owner-private tables SHOULD be partial: this member owns some of the fund's rows and
           -- must not see the rest. That is the conversation-isolation fix working, not a fault.
           when d.domain = 'owner-only' then 'PARTIAL (expected — owner-private)'
           else 'PARTIAL — investigate'
         end
    from domains d

  union all
  -- Every one of these must be > 0, or that page renders nothing for a real member.
  select 4, '4. LIVE PATHS (user-context reads)', k, v,
         case when v::bigint > 0 then 'ok' else 'ZERO — page would be blank' end
    from jsonb_each_text(current_setting('probe.live')::jsonb) as e(k, v)

  union all
  select 5, '5. NARROWED TO PORTFOLIO-ONLY', d.tbl || '  [' || d.domain || ']',
         (current_setting('probe.narrowed')::jsonb ->> d.tbl) || ' of ' ||
         (current_setting('probe.truth')::jsonb ->> d.tbl),
         case
           when (current_setting('probe.truth')::jsonb ->> d.tbl)::bigint = 0 then 'no data'
           when d.domain = 'portfolio' and (current_setting('probe.narrowed')::jsonb ->> d.tbl)
                                         = (current_setting('probe.truth')::jsonb ->> d.tbl) then 'FULL (expected)'
           when d.domain <> 'portfolio' and (current_setting('probe.narrowed')::jsonb ->> d.tbl)::bigint = 0
                then 'BLOCKED (expected)'
           else 'UNEXPECTED — investigate'
         end
    from domains d
   where current_setting('probe.narrowed')::jsonb ? d.tbl

  union all
  select 6, '6. PROBES', 'read-only grant cannot write', current_setting('probe.write'), ''
  union all
  select 6, '6. PROBES', 'service-only tables unreachable', current_setting('probe.service'), ''
) report
order by sort, item;

rollback;
