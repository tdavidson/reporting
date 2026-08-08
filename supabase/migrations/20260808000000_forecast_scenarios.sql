-- Forecast scenarios: named, per-vehicle sets of Monte Carlo assumptions plus the RNG seed.
--
-- The engine (lib/accounting/forecast.ts) is pure and seeded, so assumptions + seed reproduce
-- a simulation exactly. That makes a saved row a stable "plan": v2's plan-vs-actual compares
-- the ledger against the forecast this row regenerates, without storing a single simulated
-- number (see plans/plan-accounting-forecasting.md).
--
-- vehicle_id follows the capital_calls / distributions convention (nullable for a legacy
-- vehicle that exists only as a portfolio_group string); portfolio_group carries the name the
-- ledger actually keys on either way.

create table public.forecast_scenarios (
  id              uuid primary key default gen_random_uuid(),
  fund_id         uuid not null references funds(id) on delete cascade,
  vehicle_id      uuid references fund_vehicles(id) on delete cascade,
  portfolio_group text not null,
  name            text not null,
  -- ForecastAssumptions JSON, exactly as the engine takes it.
  assumptions     jsonb not null,
  seed            bigint not null,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now()
);

-- One scenario name per vehicle; re-saving a name updates the plan in place.
create unique index forecast_scenarios_name_idx
  on public.forecast_scenarios (fund_id, portfolio_group, name);

-- 1. Grants — required from 2026-05-30 onward for the Data API to see this table.
--    anon = SELECT only; authenticated + service_role full CRUD, with RLS scoping rows.
grant select on public.forecast_scenarios to anon;
grant select, insert, update, delete on public.forecast_scenarios to authenticated, service_role;

-- 2. RLS.
alter table public.forecast_scenarios enable row level security;

-- 3. Policies — read for any fund member, writes for admins, matching distributions.
create policy "Fund members read their fund's forecast scenarios"
  on public.forecast_scenarios for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = forecast_scenarios.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins manage their fund's forecast scenarios"
  on public.forecast_scenarios for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = forecast_scenarios.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = forecast_scenarios.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));
