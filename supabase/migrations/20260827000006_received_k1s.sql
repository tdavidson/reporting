-- K-1s RECEIVED from underlying funds, and what they block.
--
-- A fund of funds cannot finish its own tax year until every fund it holds has finished theirs.
-- That is the ordinary reason a K-1 arrives in September rather than March, and it is the one
-- piece of the delay a manager can actually manage — if they know which underlying K-1 is
-- outstanding, they can chase it.
--
-- The register the fund-of-funds work already built (20260806000000) knows which funds are held
-- and what came in from each. It did not know whether the K-1 had arrived, so the dependency was
-- carried in somebody's inbox. This adds the missing status, and the tax year close reads it.

create table public.received_k1s (
  id         uuid primary key default gen_random_uuid(),
  fund_id    uuid not null references funds(id) on delete cascade,
  -- The vehicle that HOLDS the underlying fund — the one whose tax year is blocked.
  vehicle_id uuid references fund_vehicles(id) on delete cascade,
  -- The holding, which is a `companies` row with holding_type = 'fund'.
  company_id uuid not null references companies(id) on delete cascade,
  tax_year   int  not null,

  -- 'expected'  — this holding owes us a K-1 for this year and it has not arrived.
  -- 'received'  — it arrived; `received_date` says when.
  -- 'amended'   — a later one superseded it, which is what forces our own amendment.
  -- 'not_expected' — deliberately not owed: the position closed before the year, or the holding
  --                  is not a partnership. Recorded so it stops being chased.
  status text not null default 'expected'
         check (status in ('expected', 'received', 'amended', 'not_expected')),

  received_date date,
  -- What the underlying K-1 says, kept for tie-out against what our register accrued. Not used
  -- in any computation — the point is to catch a call notice or distribution we never recorded.
  reported_ordinary_income numeric,
  reported_capital_gain    numeric,
  reported_ending_capital  numeric,

  document_id uuid references public.lp_documents(id) on delete set null,
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),

  -- One row per holding per year. An amended K-1 updates the row and flips the status rather
  -- than adding a second that silently wins by insertion order — the same rule
  -- fund_nav_statements already uses for a corrected statement.
  unique (company_id, tax_year)
);

create index received_k1s_year_idx on public.received_k1s (fund_id, vehicle_id, tax_year, status);

grant select, insert, update, delete on public.received_k1s to authenticated, service_role;
alter table public.received_k1s enable row level security;

create policy "Fund members read their fund's received K-1s"
  on public.received_k1s for select to authenticated
  using (exists (select 1 from fund_members fm where fm.fund_id = received_k1s.fund_id and fm.user_id = auth.uid()));
create policy "Fund admins manage their fund's received K-1s"
  on public.received_k1s for all to authenticated
  using (exists (select 1 from fund_members fm where fm.fund_id = received_k1s.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'))
  with check (exists (select 1 from fund_members fm where fm.fund_id = received_k1s.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'));

comment on table public.received_k1s is
  'Which underlying funds still owe us a K-1 for a tax year. Read by the tax-year close, so a '
  'year cannot be closed while a holding it depends on is outstanding.';
