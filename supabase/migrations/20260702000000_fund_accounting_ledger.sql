-- Fund accounting: double-entry ledger spine.
--
-- The book of record the platform currently lacks. Capital accounts, NAV, and
-- the financial statements are DERIVED from these tables (balances = queries
-- over journal_postings) rather than stored/typed in. Ships behind the
-- `accounting` feature flag (default `off`) while it's validated by shadow-
-- reconciling against a real fund's existing admin statements.
--
-- Invariant: every journal_entry's postings sum to zero per currency
-- (debits positive, credits negative). Enforced in lib/accounting and, later,
-- by a DB trigger; kept in application code for now to match repo conventions.

-- ---------------------------------------------------------------------------
-- chart_of_accounts — the fund's accounts. Per-LP capital accounts carry an
-- lp_entity_id so allocations can post to a specific investor's equity.
-- ---------------------------------------------------------------------------
create table public.chart_of_accounts (
  id           uuid primary key default gen_random_uuid(),
  fund_id      uuid not null references funds(id) on delete cascade,
  code         text not null,
  name         text not null,
  type         text not null check (type in ('asset', 'liability', 'equity', 'income', 'expense')),
  subtype      text,
  parent_id    uuid references chart_of_accounts(id) on delete set null,
  lp_entity_id uuid references lp_entities(id) on delete set null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (fund_id, code)
);

grant select on public.chart_of_accounts to anon;
grant select, insert, update, delete on public.chart_of_accounts to authenticated, service_role;

alter table public.chart_of_accounts enable row level security;

create policy "Fund members read their fund's accounts"
  on public.chart_of_accounts for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = chart_of_accounts.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins write their fund's accounts"
  on public.chart_of_accounts for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = chart_of_accounts.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = chart_of_accounts.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

create index chart_of_accounts_fund_idx on public.chart_of_accounts (fund_id, code);
create index chart_of_accounts_lp_entity_idx on public.chart_of_accounts (lp_entity_id) where lp_entity_id is not null;

-- ---------------------------------------------------------------------------
-- fiscal_periods — reporting periods; a period is locked once closed.
-- ---------------------------------------------------------------------------
create table public.fiscal_periods (
  id           uuid primary key default gen_random_uuid(),
  fund_id      uuid not null references funds(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  label        text,
  status       text not null default 'open' check (status in ('open', 'closed')),
  closed_at    timestamptz,
  created_at   timestamptz not null default now(),
  unique (fund_id, period_start, period_end)
);

grant select on public.fiscal_periods to anon;
grant select, insert, update, delete on public.fiscal_periods to authenticated, service_role;

alter table public.fiscal_periods enable row level security;

create policy "Fund members read their fund's periods"
  on public.fiscal_periods for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = fiscal_periods.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins write their fund's periods"
  on public.fiscal_periods for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = fiscal_periods.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = fiscal_periods.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

create index fiscal_periods_fund_idx on public.fiscal_periods (fund_id, period_end desc);

-- ---------------------------------------------------------------------------
-- journal_entries — the transaction header. status='draft' covers AI-proposed
-- entries awaiting approval; 'posted' are booked; 'void' are reversed.
-- ---------------------------------------------------------------------------
create table public.journal_entries (
  id          uuid primary key default gen_random_uuid(),
  fund_id     uuid not null references funds(id) on delete cascade,
  entry_date  date not null,
  memo        text,
  source_type text,   -- capital_call | distribution | expense | fee | valuation | opening_balance | manual | ...
  source_ref  text,   -- e.g. an inbound_emails.id / lp_documents.id / bank txn id
  status      text not null default 'draft' check (status in ('draft', 'posted', 'void')),
  period_id   uuid references fiscal_periods(id) on delete set null,
  created_by  uuid,
  posted_at   timestamptz,
  created_at  timestamptz not null default now()
);

grant select on public.journal_entries to anon;
grant select, insert, update, delete on public.journal_entries to authenticated, service_role;

alter table public.journal_entries enable row level security;

create policy "Fund members read their fund's journal entries"
  on public.journal_entries for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = journal_entries.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins write their fund's journal entries"
  on public.journal_entries for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = journal_entries.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = journal_entries.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

create index journal_entries_fund_idx on public.journal_entries (fund_id, entry_date desc);
create index journal_entries_period_idx on public.journal_entries (period_id) where period_id is not null;
create index journal_entries_status_idx on public.journal_entries (fund_id, status);

-- ---------------------------------------------------------------------------
-- journal_postings — the double-entry lines. amount is signed: debits positive,
-- credits negative. SUM(amount) per journal_entry per currency MUST equal 0
-- (enforced in lib/accounting). lp_entity_id is the optional per-LP dimension.
-- ---------------------------------------------------------------------------
create table public.journal_postings (
  id               uuid primary key default gen_random_uuid(),
  fund_id          uuid not null references funds(id) on delete cascade,
  journal_entry_id uuid not null references journal_entries(id) on delete cascade,
  account_id       uuid not null references chart_of_accounts(id) on delete restrict,
  amount           numeric(20, 2) not null,
  currency         text not null default 'USD',
  lp_entity_id     uuid references lp_entities(id) on delete set null,
  created_at       timestamptz not null default now()
);

grant select on public.journal_postings to anon;
grant select, insert, update, delete on public.journal_postings to authenticated, service_role;

alter table public.journal_postings enable row level security;

create policy "Fund members read their fund's postings"
  on public.journal_postings for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = journal_postings.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins write their fund's postings"
  on public.journal_postings for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = journal_postings.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = journal_postings.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

create index journal_postings_entry_idx on public.journal_postings (journal_entry_id);
create index journal_postings_account_idx on public.journal_postings (account_id);
create index journal_postings_fund_lp_idx on public.journal_postings (fund_id, lp_entity_id);

-- ---------------------------------------------------------------------------
-- allocation_runs / allocation_results — output of the allocation engine for a
-- period (calls/distributions/fees/expenses/gains → per-LP). Kept separate from
-- postings so an allocation can be previewed and reconciled before it's booked.
-- ---------------------------------------------------------------------------
create table public.allocation_runs (
  id         uuid primary key default gen_random_uuid(),
  fund_id    uuid not null references funds(id) on delete cascade,
  period_id  uuid references fiscal_periods(id) on delete set null,
  method     text not null default 'pro_rata',
  notes      text,
  created_by uuid,
  created_at timestamptz not null default now()
);

grant select on public.allocation_runs to anon;
grant select, insert, update, delete on public.allocation_runs to authenticated, service_role;

alter table public.allocation_runs enable row level security;

create policy "Fund members read their fund's allocation runs"
  on public.allocation_runs for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = allocation_runs.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins write their fund's allocation runs"
  on public.allocation_runs for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = allocation_runs.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = allocation_runs.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

create index allocation_runs_fund_idx on public.allocation_runs (fund_id, created_at desc);

create table public.allocation_results (
  id                uuid primary key default gen_random_uuid(),
  fund_id           uuid not null references funds(id) on delete cascade,
  allocation_run_id uuid not null references allocation_runs(id) on delete cascade,
  lp_entity_id      uuid references lp_entities(id) on delete set null,
  account_id        uuid references chart_of_accounts(id) on delete set null,
  amount            numeric(20, 2) not null,
  created_at        timestamptz not null default now()
);

grant select on public.allocation_results to anon;
grant select, insert, update, delete on public.allocation_results to authenticated, service_role;

alter table public.allocation_results enable row level security;

create policy "Fund members read their fund's allocation results"
  on public.allocation_results for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = allocation_results.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins write their fund's allocation results"
  on public.allocation_results for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = allocation_results.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = allocation_results.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

create index allocation_results_run_idx on public.allocation_results (allocation_run_id);
create index allocation_results_fund_lp_idx on public.allocation_results (fund_id, lp_entity_id);
