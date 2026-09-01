-- Portfolio construction assumptions — one model per vehicle.
--
-- What a GP STATES about the future, not what the books know. Committed capital, the fees and
-- expenses INCURRED, and the capital deployed are all derived at read time from the commitment
-- events, the ledger and the portfolio tracker; only the forward-looking assumptions live here.
--
-- Fee terms have nowhere else to go: vehicle_accounting_settings holds only allocation_basis,
-- and management fees are booked as journal entries after the fact, so nothing in the schema
-- records the RATE. See docs/superpowers/specs/2026-08-31-fund-construction-design.md.

create table public.fund_construction_models (
  id         uuid primary key default gen_random_uuid(),
  fund_id    uuid not null references funds(id) on delete cascade,
  vehicle_id uuid not null references fund_vehicles(id) on delete cascade,

  -- Fee terms, for projecting the fees not yet incurred. `fee_basis` mirrors FeeBasis in
  -- lib/accounting/fees.ts, so the projection reuses those semantics rather than inventing new.
  --
  -- EVERY STRATEGY COLUMN DEFAULTS TO ZERO OR EMPTY, matching DEFAULT_ASSUMPTIONS in
  -- lib/accounting/construction.ts. A default rate, term, portfolio size or stage mix would be
  -- one firm's strategy asserted about every fund — read as neutral, and silently wrong for
  -- anyone else. A blank field asks a question; a wrong default answers one nobody asked.
  fee_annual_rate    numeric not null default 0,
  fee_basis          text    not null default 'committed'
                     check (fee_basis in ('committed', 'invested', 'nav')),
  fee_term_years     numeric not null default 0,
  -- The fee clock. Null falls back to 1 January of the vehicle's vintage_year at read time.
  fee_start_date     date,
  fee_step_down_year numeric,
  fee_step_down_rate numeric,

  -- Forward expense run-rate.
  annual_partnership_expense numeric not null default 0,
  remaining_org_costs        numeric not null default 0,

  -- Construction.
  target_portfolio_size integer not null default 0,
  existing_reserve_pool numeric not null default 0,

  -- Return targets. The legacy sensitivity array stays empty; current sensitivity bands are
  -- derived from the portfolio plan in lib/accounting/construction.ts.
  target_fund_multiple   numeric   not null default 0,
  sensitivity_ownerships numeric[] not null default '{}',

  -- A short ORDERED list, edited as a unit and never filtered or joined on, so jsonb rather
  -- than a child table. Shape, validated by parseAssumptions() in lib/accounting/construction.ts:
  -- Each object is one planned deal (legacy aggregate rows are expanded by parseAssumptions):
  --   [{ key, label, initialCheck, initialPostMoney, followOnMultiple, dilutionFactor }]
  stages jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (fund_id, vehicle_id)
);

-- 1. Grants — required from 2026-05-30 onward for the Data API to see this table.
--    anon = SELECT only; authenticated + service_role get full CRUD, with RLS scoping rows.
grant select on public.fund_construction_models to anon;
grant select, insert, update, delete on public.fund_construction_models to authenticated, service_role;

-- 2. RLS.
alter table public.fund_construction_models enable row level security;

-- 3. Policies. Reading a model is reading the fund's plan; writing one is changing it, so writes
--    are admin-only — the same shape vehicle_accounting_settings uses for the same reason.
create policy "Fund members read their fund's construction models"
  on public.fund_construction_models for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = fund_construction_models.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins manage their fund's construction models"
  on public.fund_construction_models for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = fund_construction_models.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = fund_construction_models.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

-- The dominant read is "this vehicle's model", which the unique constraint already covers; this
-- index serves the fund-wide listing without a sequential scan.
create index fund_construction_models_vehicle_idx
  on public.fund_construction_models (fund_id, vehicle_id);
