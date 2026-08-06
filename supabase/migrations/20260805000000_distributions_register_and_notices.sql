-- The distribution register, plus the two fields a notice needs frozen.
--
-- WHY A REGISTER AT ALL. Declaring a distribution posts Dr LP capital / Cr 2300 Distributions
-- payable, and the outstanding balance derives from that posting — which is exactly why the
-- ledger alone cannot back a notice. The payable is CLEARED as wires go out, so once a
-- distribution is paid there is no longer any record of what was declared. A notice states an
-- amount a partner was told they would receive; that figure has to survive its own payment.
--
-- Mirrors capital_calls / capital_call_lines deliberately: same denormalized fund_id and
-- vehicle_id so RLS and vehicle scoping need no join, same journal_entry_id back-link, same
-- policy shape. The two sides of capital should not be two different designs.

create table public.distributions (
  id                uuid primary key default gen_random_uuid(),
  fund_id           uuid not null references funds(id) on delete cascade,
  vehicle_id        uuid references fund_vehicles(id) on delete cascade,
  distribution_date date not null,
  distribution_number int,
  description       text,
  -- 'fund_wide' = one amount split across partners (pro-rata by capital balance, editable);
  -- 'per_lp'    = declared against specific partner(s).
  scope             text not null default 'fund_wide' check (scope in ('fund_wide', 'per_lp')),
  status            text not null default 'declared' check (status in ('draft', 'declared')),
  -- The capital/payable entry this declaration posted (Dr LP capital / Cr 2300).
  journal_entry_id  uuid references public.journal_entries(id) on delete set null,
  created_at        timestamptz not null default now(),
  created_by        uuid
);

create table public.distribution_lines (
  id              uuid primary key default gen_random_uuid(),
  distribution_id uuid not null references public.distributions(id) on delete cascade,
  -- Denormalized fund_id/vehicle_id so RLS + vehicle scoping need no join.
  fund_id         uuid not null references funds(id) on delete cascade,
  vehicle_id      uuid references fund_vehicles(id) on delete cascade,
  lp_entity_id    uuid not null references lp_entities(id) on delete cascade,
  -- FROZEN. What this partner was told they would receive, whatever the payable later becomes.
  amount          numeric not null,
  created_at      timestamptz not null default now()
);

create index distributions_vehicle_idx on public.distributions (fund_id, vehicle_id, distribution_date desc);
create index distribution_lines_distribution_idx on public.distribution_lines (distribution_id);
create index distribution_lines_lp_idx on public.distribution_lines (fund_id, lp_entity_id);

-- 1. Grants — required from 2026-05-30 onward for the Data API to see these tables.
--    anon = SELECT only; authenticated + service_role full CRUD, with RLS scoping rows.
grant select on public.distributions to anon;
grant select, insert, update, delete on public.distributions to authenticated, service_role;
grant select on public.distribution_lines to anon;
grant select, insert, update, delete on public.distribution_lines to authenticated, service_role;

-- 2. RLS.
alter table public.distributions enable row level security;
alter table public.distribution_lines enable row level security;

-- 3. Policies — read for any fund member, writes for admins, matching capital_calls.
create policy "Fund members read their fund's distributions"
  on public.distributions for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = distributions.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins manage their fund's distributions"
  on public.distributions for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = distributions.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = distributions.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

create policy "Fund members read their fund's distribution lines"
  on public.distribution_lines for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = distribution_lines.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins manage their fund's distribution lines"
  on public.distribution_lines for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = distribution_lines.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = distribution_lines.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

-- A call notice is a demand with a deadline; the deadline has to be recorded at issue, not
-- inferred later.
alter table public.capital_calls add column if not exists due_date date;

-- Wire instructions for capital-call notices. Per VEHICLE, not per call: an SPV's bank details
-- are a standing fact about the vehicle, and re-typing them into every call is how one call
-- goes out with a stale account number.
alter table public.vehicle_accounting_settings
  add column if not exists wire_instructions text;
