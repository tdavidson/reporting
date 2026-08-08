-- QuickBooks migration: the confirmed account mapping, and a log of import attempts.
--
-- WHY THE MAPPING IS PERSISTED. Migrating years of history takes several passes — import,
-- spot a mis-mapped account, fix it, re-import. A mapping that were re-proposed on each run
-- would move balances between passes for no visible reason, so the confirmed answer is stored
-- and the proposal engine only fills gaps.

create table public.qb_account_mappings (
  id           uuid primary key default gen_random_uuid(),
  fund_id      uuid not null references funds(id) on delete cascade,
  vehicle_id   uuid references fund_vehicles(id) on delete cascade,
  qb_account   text not null,
  -- The chart code this QuickBooks account maps to. Null + excluded = deliberately not imported.
  account_code text,
  excluded     boolean not null default false,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (fund_id, vehicle_id, qb_account)
);

create index qb_account_mappings_fund_idx on public.qb_account_mappings (fund_id, vehicle_id);

-- One row per import attempt: what was parsed, what was written, what was skipped. Kept so a
-- third pass can see what the second one did.
create table public.qb_import_runs (
  id                   uuid primary key default gen_random_uuid(),
  fund_id              uuid not null references funds(id) on delete cascade,
  vehicle_id           uuid references fund_vehicles(id) on delete cascade,
  source_label         text,
  transactions_parsed  int not null default 0,
  entries_created      int not null default 0,
  entries_matched      int not null default 0,   -- already present by sourceRef
  transactions_skipped int not null default 0,
  errors               jsonb,
  created_at           timestamptz not null default now(),
  created_by           uuid
);

create index qb_import_runs_fund_idx on public.qb_import_runs (fund_id, created_at desc);

-- 1. Grants — required from 2026-05-30 onward for the Data API to see these tables.
--    anon = SELECT only; authenticated + service_role full CRUD, with RLS scoping rows.
grant select on public.qb_account_mappings to anon;
grant select, insert, update, delete on public.qb_account_mappings to authenticated, service_role;
grant select on public.qb_import_runs to anon;
grant select, insert, update, delete on public.qb_import_runs to authenticated, service_role;

-- 2. RLS.
alter table public.qb_account_mappings enable row level security;
alter table public.qb_import_runs      enable row level security;

-- 3. Policies — fund members read and manage, matching the accounting tables these feed.
create policy "Fund members read qb account mappings"
  on public.qb_account_mappings for select to authenticated
  using (fund_id = any(public.get_my_fund_ids()));
create policy "Fund members manage qb account mappings"
  on public.qb_account_mappings for all to authenticated
  using (fund_id = any(public.get_my_fund_ids()))
  with check (fund_id = any(public.get_my_fund_ids()));

create policy "Fund members read qb import runs"
  on public.qb_import_runs for select to authenticated
  using (fund_id = any(public.get_my_fund_ids()));
create policy "Fund members manage qb import runs"
  on public.qb_import_runs for all to authenticated
  using (fund_id = any(public.get_my_fund_ids()))
  with check (fund_id = any(public.get_my_fund_ids()));
