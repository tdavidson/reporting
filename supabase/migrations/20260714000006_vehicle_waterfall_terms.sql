-- Per-vehicle carry terms, so the close can ACCRUE carried interest on unrealized gains.
--
-- WHY ACCRUE AT ALL. Under ASC 946 a fund accrues carried interest at each reporting date on a
-- HYPOTHETICAL LIQUIDATION: run the waterfall as if the fund sold everything at today's NAV,
-- and book the GP's resulting share as an allocation between partners' capital accounts. If
-- you don't, every LP's reported NAV overstates what they would actually receive by the GP's
-- share of the unrealized gain — on a marked-up fund that is not a rounding difference, and an
-- LP comparing your statement to another fund's is comparing gross to net.
--
-- It is an EQUITY REALLOCATION, not an expense: Dr each LP's capital / Cr the GP's capital.
-- No P&L, no cash. It reverses on its own if NAV falls, because the close recomputes the
-- TARGET accrual each period and posts only the delta.
--
-- WHY PER VEHICLE. A fund and an SPV rarely share terms — the fund runs a European waterfall
-- with an 8% pref and a catch-up; the SPV is often a straight 80/20 over contributed capital.
-- Storing this per vehicle is the only honest model.

create table public.vehicle_waterfall_terms (
  id            uuid primary key default gen_random_uuid(),
  fund_id       uuid not null references funds(id) on delete cascade,
  vehicle_id    uuid not null references fund_vehicles(id) on delete cascade,

  -- 'none'     — no carry. The default: accruing carry nobody agreed to is worse than none.
  -- 'straight' — carryRate of profit above contributed capital. No pref, no catch-up.
  -- 'european' — whole-fund: return of capital → preferred → GP catch-up → split.
  kind          text not null default 'none'
                check (kind in ('none', 'straight', 'european')),

  /** GP's share of profits, as a fraction. 0.20 = 20%. */
  carry_rate    numeric not null default 0
                check (carry_rate >= 0 and carry_rate < 1),

  /** Annual preferred return (hurdle), as a fraction. 0.08 = 8%. European only. */
  pref_rate     numeric not null default 0
                check (pref_rate >= 0 and pref_rate < 1),

  /** GP's share during the catch-up tier. 1.0 = full catch-up. European only. */
  catchup_rate  numeric not null default 1
                check (catchup_rate >= 0 and catchup_rate <= 1),

  /** Is the preferred return compounded annually, or simple? */
  pref_compounds boolean not null default true,

  -- Which partner RECEIVES the carry. An lp_entity (normally partner_class = 'gp'), so the
  -- accrual lands in a real per-partner capital account and shows up in that partner's
  -- `carriedInterest` roll-forward bucket. That bucket is what the associates look-through
  -- splits by carry points — which is why crediting the pooled 3000 account would not do.
  gp_entity_id  uuid references lp_entities(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (fund_id, vehicle_id)
);

create index vehicle_waterfall_terms_vehicle_idx
  on public.vehicle_waterfall_terms (fund_id, vehicle_id);

-- 1. Grants — required from 2026-05-30 onward for the Data API to see this table.
grant select on public.vehicle_waterfall_terms to anon;
grant select, insert, update, delete on public.vehicle_waterfall_terms to authenticated, service_role;

-- 2. RLS.
alter table public.vehicle_waterfall_terms enable row level security;

-- 3. Policies.
create policy "Fund members read their fund's waterfall terms"
  on public.vehicle_waterfall_terms for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = vehicle_waterfall_terms.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins manage their fund's waterfall terms"
  on public.vehicle_waterfall_terms for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = vehicle_waterfall_terms.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = vehicle_waterfall_terms.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

-- ---------------------------------------------------------------------------
-- The associates look-through link.
-- ---------------------------------------------------------------------------
-- An associate/GP vehicle keeps its own books AND holds a position in the fund it serves. To
-- look through it — attributing its position in the fund back to its own members — we need to
-- know WHICH lp_entity on the fund's books represents it.
--
-- This used to be inferred by matching free text: `lp_associates_overrides` stored an
-- `associates_entity` NAME that had to match both an `lp_investors.name` and a
-- `portfolio_group` string. Rename anything and the look-through silently stopped matching,
-- and nobody found out until an LP's returns were wrong. This is the id.
alter table public.fund_vehicles
  add column if not exists lp_entity_id uuid references lp_entities(id) on delete set null;

comment on column public.fund_vehicles.lp_entity_id is
  'For an associate/GP vehicle: the lp_entity through which it invests in serves_vehicle_id. '
  'Replaces name-matching for the associates look-through.';
