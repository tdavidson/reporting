-- Per-user, per-domain access rights.
--
-- Replaces "if a user can see it in the nav, they can access it." Two axes, deliberately not
-- collapsed into one:
--   * fund_settings.feature_visibility — is this content area on for the fund, and its ceiling.
--     Unchanged by this migration.
--   * these tables — which member may read/write it. Grants can only ever NARROW the ceiling.
--
-- The resolver that reads these is lib/access/effective.ts; every surface (UI, Analyst, MCP, API
-- keys) goes through it. See docs/plan-access-control.md.

-- 1. fund_members.role has been unconstrained text since it was added
--    (20260227000013_allowed_signups.sql: `add column role text not null default 'member'`).
--    Now that role is load-bearing for access resolution, constrain it. Any row that somehow
--    holds something else is normalised to the least-power value first, so the constraint can be
--    added without failing on existing data.
update fund_members set role = 'member' where role not in ('admin', 'member', 'viewer');

alter table fund_members
  drop constraint if exists fund_members_role_check;
alter table fund_members
  add constraint fund_members_role_check check (role in ('admin', 'member', 'viewer'));

-- 2. A member's explicit grant for one domain. No row = fall back to the fund's default below.
--    Domain is text rather than an enum: the domain list lives in lib/access/domains.ts, and a
--    pg enum would mean a migration every time it changes while buying nothing the app doesn't
--    already validate.
create table public.fund_member_access (
  fund_id    uuid not null references funds(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  domain     text not null,
  level      text not null check (level in ('none', 'read', 'write')),
  updated_at timestamptz not null default now(),
  -- set null, not cascade: removing the admin who granted access must not delete the grant (nor
  -- fail on the FK). Who granted it is provenance; losing it is survivable, losing the grant isn't.
  updated_by uuid references auth.users(id) on delete set null,
  primary key (fund_id, user_id, domain)
);

-- Grants — required from 2026-05-30 onward for the Data API to see this table.
grant select on public.fund_member_access to anon;
grant select, insert, update, delete on public.fund_member_access to authenticated, service_role;

alter table public.fund_member_access enable row level security;

-- A member may see their OWN grants (the app tells them what they can reach); only an admin of
-- the fund may see everyone's or change any. Writes go through the service role in practice —
-- these policies are the secondary defence.
create policy "Members read their own access grants"
  on public.fund_member_access for select to authenticated
  using (user_id = auth.uid() or public.is_fund_admin(fund_id));

create policy "Fund admins manage access grants"
  on public.fund_member_access for all to authenticated
  using (public.is_fund_admin(fund_id))
  with check (public.is_fund_admin(fund_id));

create index idx_fund_member_access_user on public.fund_member_access (user_id);

-- `updated_at` is an audit trail of who changed access and when, so it must not depend on each
-- writer remembering to set it (the settings API does; psql and a future route won't).
create trigger set_fund_member_access_updated_at
  before update on public.fund_member_access
  for each row execute function public.set_updated_at();

-- 3. What a NEW member of this fund gets in each domain, set once by the admin. Also the fallback
--    for any existing member without an explicit grant.
create table public.fund_domain_defaults (
  fund_id    uuid not null references funds(id) on delete cascade,
  domain     text not null,
  level      text not null check (level in ('none', 'read', 'write')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (fund_id, domain)
);

grant select on public.fund_domain_defaults to anon;
grant select, insert, update, delete on public.fund_domain_defaults to authenticated, service_role;

alter table public.fund_domain_defaults enable row level security;

-- Every member may read the defaults (they describe that member's own baseline); admins set them.
create policy "Fund members read domain defaults"
  on public.fund_domain_defaults for select to authenticated
  using (fund_id = any(public.get_my_fund_ids()));

create policy "Fund admins manage domain defaults"
  on public.fund_domain_defaults for all to authenticated
  using (public.is_fund_admin(fund_id))
  with check (public.is_fund_admin(fund_id));

create trigger set_fund_domain_defaults_updated_at
  before update on public.fund_domain_defaults
  for each row execute function public.set_updated_at();

-- 4. Seed every existing fund's defaults to REPRODUCE TODAY'S BEHAVIOUR, so no one's access
--    changes when this ships. Today a member can write anything the fund has switched on (the
--    fund-level switch is the only gate, and 137 routes don't even check role), so the honest
--    equivalent is 'write' on every non-admin domain. The fund-level switch still applies on top:
--    a member gets nothing in an area set to admin/hidden/off, exactly as now.
--
--    The admin then REMOVES what shouldn't be shared, rather than discovering their team locked
--    out on deploy day. `admin` is omitted deliberately — it is role-governed, never granted.
insert into public.fund_domain_defaults (fund_id, domain, level)
select f.id, d.domain, 'write'
from funds f
cross join (values
  ('portfolio'), ('relationships'), ('dealflow'), ('diligence'),
  ('accounting'), ('lp_capital'), ('gp_economics'), ('lp_relations'), ('compliance')
) as d(domain)
on conflict (fund_id, domain) do nothing;

-- New funds get the same baseline, so a fresh install behaves like an existing one.
create or replace function public.seed_fund_domain_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.fund_domain_defaults (fund_id, domain, level)
  select new.id, d.domain, 'write'
  from (values
    ('portfolio'), ('relationships'), ('dealflow'), ('diligence'),
    ('accounting'), ('lp_capital'), ('gp_economics'), ('lp_relations'), ('compliance')
  ) as d(domain)
  on conflict (fund_id, domain) do nothing;
  return new;
end;
$$;

create trigger seed_domain_defaults_on_fund_create
  after insert on funds
  for each row execute function public.seed_fund_domain_defaults();

comment on table public.fund_member_access is
  'Per-user, per-domain access grants. Narrows fund_settings.feature_visibility; never widens it. Resolved by lib/access/effective.ts.';
comment on table public.fund_domain_defaults is
  'Per-fund default access level per domain, for members without an explicit fund_member_access row.';
