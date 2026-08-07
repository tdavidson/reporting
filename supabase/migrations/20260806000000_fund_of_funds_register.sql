-- Fund-of-funds: a holding that is itself a FUND, plus the register that a fund holding
-- has and a company holding does not — a commitment, notices received, and a manager NAV
-- with an as-of date.
--
-- WHY A REGISTER ABOVE investment_transactions. The three FoF events map exactly onto the
-- existing transaction types (a call is an `investment` at cost, a NAV statement is an
-- `unrealized_gain_change`, a distribution is `proceeds` with cost_basis_exited carrying the
-- return-of-capital split). What they carry that a transaction cannot is the notice itself:
-- the purpose split on a call, the character split on a distribution, and the as-of date that
-- makes a NAV valuable 60 days after it was struck. The register stores the notice; the
-- transaction it produces stays the single path to the ledger.

-- ---------------------------------------------------------------------------
-- 1. The discriminator.
-- ---------------------------------------------------------------------------
-- Default 'company' means every existing row and every existing insert is unaffected.
alter table public.companies
  add column if not exists holding_type text not null default 'company';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'companies_holding_type_check'
  ) then
    alter table public.companies
      add constraint companies_holding_type_check
      check (holding_type in ('company', 'fund'));
  end if;
end $$;

create index if not exists companies_holding_type_idx
  on public.companies (fund_id, holding_type);

-- ---------------------------------------------------------------------------
-- 2. Terms — 1:1 with a fund holding.
-- ---------------------------------------------------------------------------
-- Commitment is a SCALAR, not an event series. Unfunded is derived as
--   commitment - sum(calls) + sum(recallable returned)
-- so it cannot drift from the register. Promote to a commitment_events-shaped table only
-- when a real upsize/transfer/secondary appears.
create table public.fund_holding_terms (
  id               uuid primary key default gen_random_uuid(),
  fund_id          uuid not null references funds(id) on delete cascade,
  company_id       uuid not null unique references companies(id) on delete cascade,
  manager_name     text,
  vintage_year     int,
  fund_size        numeric,
  strategy         text,
  geography        text,
  commitment       numeric not null default 0,
  commitment_date  date,
  final_close_date date,
  term_end_date    date,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index fund_holding_terms_fund_idx on public.fund_holding_terms (fund_id);

-- ---------------------------------------------------------------------------
-- 3. Capital events RECEIVED — the inbound mirror of capital_calls / distributions.
-- ---------------------------------------------------------------------------
-- Amounts are MAGNITUDES; `kind` carries the direction.
create table public.fund_capital_events (
  id            uuid primary key default gen_random_uuid(),
  fund_id       uuid not null references funds(id) on delete cascade,
  vehicle_id    uuid references fund_vehicles(id) on delete cascade,
  company_id    uuid not null references companies(id) on delete cascade,
  kind          text not null check (kind in ('call', 'distribution')),
  event_date    date not null,
  due_date      date,
  notice_number text,
  description   text,
  amount        numeric not null check (amount >= 0),

  -- Calls: all three capitalize into cost basis under ASC 946, but LPs and auditors want
  -- them disclosed separately, so the split is captured rather than collapsed.
  purpose_investments numeric not null default 0,
  purpose_fees        numeric not null default 0,
  purpose_expenses    numeric not null default 0,

  -- Distributions: the character split. char_return_of_capital becomes cost_basis_exited on
  -- the produced transaction; the rest is realized gain / income.
  char_return_of_capital numeric not null default 0,
  char_realized_gain     numeric not null default 0,
  char_income            numeric not null default 0,
  -- Recallable amounts RESTORE unfunded commitment when returned.
  recallable_amount      numeric not null default 0,

  -- The transaction this row produced. Null while draft, or when the event predates
  -- ledger_start_date (memo-only history — see the column comment below).
  investment_transaction_id uuid references public.investment_transactions(id) on delete set null,

  status     text not null default 'draft' check (status in ('draft', 'confirmed')),
  source     text not null default 'manual' check (source in ('manual', 'grid', 'extracted', 'import')),
  created_at timestamptz not null default now(),
  created_by uuid
);

create index fund_capital_events_holding_idx on public.fund_capital_events (fund_id, company_id, event_date);
create index fund_capital_events_status_idx  on public.fund_capital_events (fund_id, status);

-- ---------------------------------------------------------------------------
-- 4. Manager NAV statements.
-- ---------------------------------------------------------------------------
-- as_of_date is the manager's valuation date, NOT when it arrived. The gap between the two
-- is the whole reason this table exists: underlying funds report 45-90 days late, so a Q1
-- report is produced from Q4-or-earlier NAVs rolled forward for our own cash flows.
--
-- reported_* are the MANAGER's own since-inception figures. They are not used in any
-- computation — they exist so our register can be tied out against the manager's statement,
-- which is what catches a call notice we never received.
create table public.fund_nav_statements (
  id            uuid primary key default gen_random_uuid(),
  fund_id       uuid not null references funds(id) on delete cascade,
  vehicle_id    uuid references fund_vehicles(id) on delete cascade,
  company_id    uuid not null references companies(id) on delete cascade,
  as_of_date    date not null,
  received_date date,
  reported_nav  numeric not null,
  basis         text not null default 'final' check (basis in ('final', 'preliminary', 'estimate')),

  reported_contributions numeric,
  reported_distributions numeric,
  reported_unfunded      numeric,

  document_id uuid,
  source      text not null default 'manual' check (source in ('manual', 'grid', 'extracted', 'import')),
  investment_transaction_id uuid references public.investment_transactions(id) on delete set null,
  created_at  timestamptz not null default now(),
  created_by  uuid,

  -- One statement per holding per valuation date. A corrected statement UPDATES the row
  -- rather than adding a second one that silently wins by insertion order.
  unique (company_id, as_of_date)
);

create index fund_nav_statements_holding_idx on public.fund_nav_statements (fund_id, company_id, as_of_date desc);

-- ---------------------------------------------------------------------------
-- 5. The migration cut-over date.
-- ---------------------------------------------------------------------------
-- Register events dated BEFORE this produce no investment_transactions: the ledger for that
-- period came from the migrated system, and re-posting them would double-count. They still
-- count for every derived metric, which is the point — TVPI/DPI/IRR need the full dated
-- cash-flow history even when the entries came from somewhere else.
alter table public.vehicle_accounting_settings
  add column if not exists ledger_start_date date;

-- ---------------------------------------------------------------------------
-- 6. Grants — required from 2026-05-30 onward for the Data API to see these tables.
--    anon = SELECT only; authenticated + service_role full CRUD, with RLS scoping rows.
-- ---------------------------------------------------------------------------
grant select on public.fund_holding_terms to anon;
grant select, insert, update, delete on public.fund_holding_terms to authenticated, service_role;
grant select on public.fund_capital_events to anon;
grant select, insert, update, delete on public.fund_capital_events to authenticated, service_role;
grant select on public.fund_nav_statements to anon;
grant select, insert, update, delete on public.fund_nav_statements to authenticated, service_role;

-- 7. RLS.
alter table public.fund_holding_terms  enable row level security;
alter table public.fund_capital_events enable row level security;
alter table public.fund_nav_statements enable row level security;

-- 8. Policies — fund members read, fund members manage (matching investment_transactions,
--    which is the sibling table these rows produce).
create policy "Fund members read fund holding terms"
  on public.fund_holding_terms for select to authenticated
  using (fund_id = any(public.get_my_fund_ids()));
create policy "Fund members manage fund holding terms"
  on public.fund_holding_terms for all to authenticated
  using (fund_id = any(public.get_my_fund_ids()))
  with check (fund_id = any(public.get_my_fund_ids()));

create policy "Fund members read fund capital events"
  on public.fund_capital_events for select to authenticated
  using (fund_id = any(public.get_my_fund_ids()));
create policy "Fund members manage fund capital events"
  on public.fund_capital_events for all to authenticated
  using (fund_id = any(public.get_my_fund_ids()))
  with check (fund_id = any(public.get_my_fund_ids()));

create policy "Fund members read fund nav statements"
  on public.fund_nav_statements for select to authenticated
  using (fund_id = any(public.get_my_fund_ids()));
create policy "Fund members manage fund nav statements"
  on public.fund_nav_statements for all to authenticated
  using (fund_id = any(public.get_my_fund_ids()))
  with check (fund_id = any(public.get_my_fund_ids()));
