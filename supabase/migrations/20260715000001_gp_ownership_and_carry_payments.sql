-- GP / associate entity economics, on the accounting side.
--
-- CONTEXT. A GP or "associates" vehicle invests in the fund through one lp_entity
-- (fund_vehicles.serves_vehicle_id + lp_entity_id), and its own members hold two DIFFERENT
-- economics in it:
--
--   ownership  — their share of the capital the vehicle contributed, and its returns.
--   carry      — their share of the carried interest the vehicle EARNS.
--
-- These routinely diverge, and a member can hold carry while committing no capital at all.
-- lib/accounting/look-through.ts already models this correctly: it splits every line of the
-- associate's capital account by ownership EXCEPT `carriedInterest`, which it splits by
-- carry points (partner_allocation_terms, category 'carried_interest').
--
-- The old model on the LPs page (lp_associates_overrides) got this wrong twice: it matched
-- entities by free-text NAME, and it netted carry off the member's NAV — conflating an
-- allocation of a carry pool with a haircut on capital. Nothing in lib/accounting reads it.
-- It is left in place here (the snapshot pipeline still uses it) and simply not extended.
--
-- This migration adds the two things the correct model is missing.

-- ---------------------------------------------------------------------------
-- 1. Ownership override, for vehicles with no commitment basis
-- ---------------------------------------------------------------------------
-- Ownership is normally DERIVED from commitment_events on the associate vehicle — that is
-- what the look-through uses, and a derived number cannot drift from the books. But a
-- vehicle that keeps no capital record at all has no commitments to derive from, and its
-- ownership has to be stated.
--
-- Semantics deliberately mirror the one good half of the old model: an override row WINS;
-- absent means derive. Weights are normalized downstream, so they can be entered as
-- percentages (20/80) or as raw points — same convention as
-- partner_allocation_terms.weight_override.

create table public.vehicle_partner_ownership (
  id               uuid primary key default gen_random_uuid(),
  fund_id          uuid not null references funds(id) on delete cascade,
  vehicle_id       uuid not null references fund_vehicles(id) on delete cascade,
  lp_entity_id     uuid not null references lp_entities(id) on delete cascade,
  ownership_weight numeric not null check (ownership_weight >= 0),
  memo             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (fund_id, vehicle_id, lp_entity_id)
);

create index vehicle_partner_ownership_vehicle_idx
  on public.vehicle_partner_ownership (fund_id, vehicle_id);

grant select on public.vehicle_partner_ownership to anon;
grant select, insert, update, delete on public.vehicle_partner_ownership to authenticated, service_role;

alter table public.vehicle_partner_ownership enable row level security;

create policy "Fund members read their fund's partner ownership"
  on public.vehicle_partner_ownership for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = vehicle_partner_ownership.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins manage their fund's partner ownership"
  on public.vehicle_partner_ownership for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = vehicle_partner_ownership.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = vehicle_partner_ownership.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

-- ---------------------------------------------------------------------------
-- 2. Carry payments
-- ---------------------------------------------------------------------------
-- Carry ACCRUED is already derivable: the close credits it to the GP partner's
-- `carriedInterest` roll-forward bucket on the fund's books (close.ts accrueCarry), and the
-- look-through splits that bucket among the vehicle's members by carry points.
--
-- Carry PAID has no representation at all. A distribution out of the GP entity is today
-- indistinguishable from a return of capital, so "how much carry has actually been paid to
-- this partner" is unanswerable — and therefore so is "how much is accrued and unpaid".
--
-- This is a REGISTER, not a second source of truth. Same pattern as capital_calls: it
-- CLASSIFIES the movement that actually happened (linking the journal entry or the capital
-- event that booked it) rather than recording the money a second time. If it recorded the
-- payment independently, the register and the capital accounts would drift, and the
-- register would start winning arguments it should lose.
--
-- ACCRUED CARRY IS A MARK, NOT A DEBT. It is recomputed from NAV at each close and reverses
-- if NAV falls. "Accrued and unpaid" therefore means "what you would be owed if the fund
-- liquidated today" — not a receivable. Anything built on this table must say so.

create table public.carry_payments (
  id                  uuid primary key default gen_random_uuid(),
  fund_id             uuid not null references funds(id) on delete cascade,
  -- The GP / associate vehicle whose carry is being paid out.
  vehicle_id          uuid not null references fund_vehicles(id) on delete cascade,
  -- The partner receiving it.
  lp_entity_id        uuid not null references lp_entities(id) on delete cascade,
  paid_date           date not null,
  amount              numeric not null check (amount > 0),
  -- What actually moved the money. Either may be null (a payment made before the books
  -- existed), but a linked row is what keeps the register honest.
  journal_entry_id    uuid references journal_entries(id) on delete set null,
  lp_capital_event_id uuid references lp_capital_events(id) on delete set null,
  memo                text,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id)
);

create index carry_payments_vehicle_idx on public.carry_payments (fund_id, vehicle_id);
create index carry_payments_entity_idx  on public.carry_payments (fund_id, lp_entity_id);

grant select on public.carry_payments to anon;
grant select, insert, update, delete on public.carry_payments to authenticated, service_role;

alter table public.carry_payments enable row level security;

create policy "Fund members read their fund's carry payments"
  on public.carry_payments for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = carry_payments.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins manage their fund's carry payments"
  on public.carry_payments for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = carry_payments.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = carry_payments.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

comment on table public.carry_payments is
  'Register of carried interest actually PAID to a GP/associate vehicle''s partners. Classifies the distribution that moved the money; does not record it a second time. Accrued carry (the carriedInterest bucket) is a mark, not a debt.';
