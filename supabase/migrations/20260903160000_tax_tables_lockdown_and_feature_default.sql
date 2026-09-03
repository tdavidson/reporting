-- Two small things the tax-reporting merge needs to line up with the access model that landed
-- after it was written.
--
-- 1. The tax tables are SERVICE-ROLE ONLY, and now say so in the negative as well as the positive.
--    Their own migrations grant to service_role and enable RLS with no policies, which denies every
--    row to anon/authenticated. But this project predates Supabase's 2026-05-30 "explicit grants"
--    cutover, so a new table here STILL receives default SELECT/INSERT/UPDATE/DELETE grants to
--    anon and authenticated at creation. RLS makes those grants inert today; revoking them means a
--    future "create policy" on one of these tables cannot, by itself, expose a partner's K-1.
--    Same posture as every other service table (see 20260902174637 section 8 and
--    lib/access/table-domains.ts, where these eight are registered).
--
-- 2. `public.feature_default()` learns `tax_reporting`. The branch added the key to
--    DEFAULT_FEATURE_VISIBILITY with default 'off', which the function's `else` branch already
--    returns — so nothing changes at runtime. But rls-domain-policies.test.ts pins the SQL and the
--    TypeScript copies of that table together on purpose, and an implicit match is a drift waiting
--    to happen.

revoke all on public.lp_tax_forms from anon, authenticated;
revoke all on public.k1_packages from anon, authenticated;
revoke all on public.k1_partners from anon, authenticated;
revoke all on public.k1_lines from anon, authenticated;
revoke all on public.tax_year_closes from anon, authenticated;
revoke all on public.received_k1s from anon, authenticated;
revoke all on public.k1_deliveries from anon, authenticated;
revoke all on public.k1_delivery_consents from anon, authenticated;

grant select, insert, update, delete on public.lp_tax_forms to service_role;
grant select, insert, update, delete on public.k1_packages to service_role;
grant select, insert, update, delete on public.k1_partners to service_role;
grant select, insert, update, delete on public.k1_lines to service_role;
grant select, insert, update, delete on public.tax_year_closes to service_role;
grant select, insert, update, delete on public.received_k1s to service_role;
grant select, insert, update, delete on public.k1_deliveries to service_role;
grant select, insert, update, delete on public.k1_delivery_consents to service_role;

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
    when 'tax_reporting' then 'off'
    -- An unknown key is not a reason to open a door.
    else 'off'
  end;
$$;
