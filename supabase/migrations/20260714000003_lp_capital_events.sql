-- Lightweight LP capital events — the second producer of `CapitalPosting[]`.
--
-- WHY THIS EXISTS
-- `computeCapitalAccounts()` (lib/accounting/capital-account.ts) is a pure function over
-- `{lpEntityId, entryDate, amount, sourceType}` — it does not care where those came from.
-- Today the only producer is `journal_postings`, so an LP capital account (and therefore a
-- live capital report) is only possible for a vehicle with full double-entry books.
--
-- Plenty of vehicles will never have books: an SPV, a direct investment, a fund whose
-- admin sends a quarterly statement. They still have LPs with contributions, distributions
-- and a NAV. This table is the LP-facing leg of a ledger and nothing more — no chart of
-- accounts, no double entry, no balancing, no close. One row = one thing that moved an
-- LP's capital.
--
-- SHAPE IS DELIBERATE: `amount` and `source_type` use the SAME conventions as
-- `journal_postings` / `journal_entries`, so the adapter into `CapitalPosting` is the
-- identity function and both kinds of vehicle flow through identical downstream code —
-- same roll-forward, same statement PDF, same portal numbers.
--
--   amount: DEBIT-POSITIVE, exactly like journal_postings.amount. Capital is a credit
--           balance, so `capitalDelta = -amount` (see capital-account.ts:195). A $100k
--           contribution is amount = -100000. Hand-entry UIs take a natural signed
--           capital delta and negate on the way in — never expose this convention to a user.
--
--   source_type: drives `bucketForSourceType()`, which decides the roll-forward line. The
--           check constraint below is the full set that buckets to a real line; anything
--           else would silently land in `unclassified`.

create table public.lp_capital_events (
  id            uuid primary key default gen_random_uuid(),
  fund_id       uuid not null references funds(id) on delete cascade,
  vehicle_id    uuid not null references fund_vehicles(id) on delete cascade,
  lp_entity_id  uuid not null references lp_entities(id) on delete cascade,
  event_date    date not null,
  amount        numeric not null,
  source_type   text not null check (source_type in (
    'opening_balance',
    'capital_call', 'contribution',
    'distribution',
    'management_fee',
    'partnership_expense', 'organizational_expense',
    'income',
    'realized_gain',
    'valuation',
    'fx_revaluation',
    'transfer',
    'carried_interest',
    'manual'
  )),
  memo          text,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id)
);

-- The dominant read is "every event for this vehicle up to a date", to build a report
-- as of that date.
create index lp_capital_events_vehicle_date_idx
  on public.lp_capital_events (fund_id, vehicle_id, event_date);
create index lp_capital_events_entity_idx
  on public.lp_capital_events (fund_id, lp_entity_id);

-- 1. Grants — required from 2026-05-30 onward for the Data API to see this table.
grant select on public.lp_capital_events to anon;
grant select, insert, update, delete on public.lp_capital_events to authenticated, service_role;

-- 2. RLS.
alter table public.lp_capital_events enable row level security;

-- 3. Policies. Reads for any fund member; writes for admins only — these rows ARE the LP's
--    capital account for an unbooked vehicle, so they carry the same weight as a posting.
create policy "Fund members read their fund's LP capital events"
  on public.lp_capital_events for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = lp_capital_events.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins manage their fund's LP capital events"
  on public.lp_capital_events for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = lp_capital_events.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = lp_capital_events.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

-- ---------------------------------------------------------------------------
-- Which producer does a vehicle use?
-- ---------------------------------------------------------------------------
-- Explicit, never inferred. Inferring from "does a chart of accounts exist?" would
-- double-count the instant someone seeds a chart on a vehicle that already has events —
-- both producers would return postings for the same period and the LP's capital would
-- double. One vehicle reads from exactly one source.
--
-- Default 'events': a vehicle that has never been onboarded to the ledger has no journal
-- postings, so 'events' is the only source that can say anything about it. Vehicles with
-- real books are switched to 'ledger' (the backfill below does the existing ones).
alter table public.vehicle_accounting_settings
  add column if not exists capital_source text not null default 'events'
    check (capital_source in ('ledger', 'events'));

comment on column public.vehicle_accounting_settings.capital_source is
  'Which producer supplies this vehicle''s CapitalPosting[]: its double-entry books '
  '(ledger) or the lightweight lp_capital_events table (events). Never both — that would '
  'double-count. Promotion events -> ledger is a one-way cutover.';

-- Any vehicle that already has posted journal entries is a ledger vehicle. Without this,
-- every booked vehicle would silently flip to reading an empty events table.
insert into public.vehicle_accounting_settings (fund_id, vehicle_id, capital_source)
select distinct je.fund_id, je.vehicle_id, 'ledger'
from public.journal_entries je
where je.vehicle_id is not null
  and je.status = 'posted'
on conflict (fund_id, vehicle_id) do update set capital_source = 'ledger';
