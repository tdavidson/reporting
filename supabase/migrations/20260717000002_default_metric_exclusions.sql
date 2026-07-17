-- Per-company opt-out from a fund-wide default metric. When a company shouldn't track one of the
-- fund's default metrics (e.g. "ARR" on a company that isn't SaaS), an exclusion row here makes the
-- seeder skip that default for that company — on manual seed, on fund-wide sync, and at company
-- creation. Excluding does NOT delete a metric already on the company; it only prevents (re-)seeding.
create table default_metric_exclusions (
  id                 uuid    primary key default gen_random_uuid(),
  fund_id            uuid    references funds(id) on delete cascade not null,
  company_id         uuid    references companies(id) on delete cascade not null,
  default_metric_id  uuid    references default_metrics(id) on delete cascade not null,
  created_at         timestamptz default now(),
  unique(company_id, default_metric_id)
);

-- 1. Grants — required from 2026-05-30 onward for the Data API to see this table.
grant select on public.default_metric_exclusions to anon;
grant select, insert, update, delete on public.default_metric_exclusions to authenticated, service_role;

-- 2. RLS — fund-scoped, matching the rest of the metrics tables.
alter table default_metric_exclusions enable row level security;

-- 3. Policy — fund members manage their own fund's exclusions.
create policy "Fund members can manage default metric exclusions"
  on default_metric_exclusions for all
  using (fund_id = any(public.get_my_fund_ids()));
