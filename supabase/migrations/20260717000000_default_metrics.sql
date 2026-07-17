-- Fund-wide "default metric profile": a template set of metrics an admin defines once
-- and that gets seeded into every portfolio company (existing ones now, new ones at
-- creation). These rows are TEMPLATES only — once copied into a company they become that
-- company's own `metrics` row and are never mutated or removed from here. Dedup on apply is
-- by (company_id, slug), mirroring the unique(company_id, slug) constraint on `metrics`.
create table default_metrics (
  id                  uuid    primary key default gen_random_uuid(),
  fund_id             uuid    references funds(id) on delete cascade not null,
  name                text    not null,
  slug                text    not null,
  description         text,
  unit                text,
  unit_position       text    default 'suffix'
                              check (unit_position in ('prefix', 'suffix')),
  value_type          text    default 'number'
                              check (value_type in ('number', 'currency', 'percentage', 'text')),
  reporting_cadence   text    default 'quarterly'
                              check (reporting_cadence in ('quarterly', 'monthly', 'annual')),
  display_order       int     default 0,
  currency            text,
  is_active           boolean default true,
  created_at          timestamptz default now(),
  unique(fund_id, slug)
);

-- 1. Grants — required from 2026-05-30 onward for the Data API to see this table.
grant select on public.default_metrics to anon;
grant select, insert, update, delete on public.default_metrics to authenticated, service_role;

-- 2. RLS — matches the fund-scoped policy used by `metrics` / `metric_values`.
alter table default_metrics enable row level security;

-- 3. Policy — fund members manage their own fund's default-metric profile.
create policy "Fund members can manage default metrics"
  on default_metrics for all
  using (fund_id = any(public.get_my_fund_ids()));
