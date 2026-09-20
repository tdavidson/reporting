-- Deterministic recurring/accrual schedules used by the close assistant. The close proposes
-- missing entries as drafts; it never posts them without review.
create table public.accounting_schedules (
  id                  uuid primary key default gen_random_uuid(),
  fund_id             uuid not null references public.funds(id) on delete cascade,
  vehicle_id          uuid not null references public.fund_vehicles(id) on delete cascade,
  name                text not null,
  memo                text,
  source_type         text not null default 'adjusting',
  start_date          date not null,
  end_date            date,
  frequency           text not null default 'monthly' check (frequency in ('monthly')),
  day_of_month        smallint not null default 1 check (day_of_month between 1 and 31),
  required_for_close  boolean not null default true,
  active              boolean not null default true,
  source_entry_id     uuid references public.journal_entries(id) on delete set null,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.accounting_schedule_lines (
  id             uuid primary key default gen_random_uuid(),
  schedule_id    uuid not null references public.accounting_schedules(id) on delete cascade,
  account_id     uuid not null references public.chart_of_accounts(id) on delete restrict,
  amount         numeric(20, 2) not null,
  lp_entity_id   uuid references public.lp_entities(id) on delete set null,
  sort_order     integer not null default 0
);

create index accounting_schedules_vehicle_idx
  on public.accounting_schedules (fund_id, vehicle_id, active, start_date);
create index accounting_schedule_lines_schedule_idx
  on public.accounting_schedule_lines (schedule_id, sort_order);

alter table public.accounting_schedules enable row level security;
alter table public.accounting_schedule_lines enable row level security;
revoke all on public.accounting_schedules, public.accounting_schedule_lines from anon, authenticated;
grant select, insert, update, delete on public.accounting_schedules, public.accounting_schedule_lines to service_role;
create policy "accounting_schedules service role" on public.accounting_schedules for all to service_role using (true) with check (true);
create policy "accounting_schedule_lines service role" on public.accounting_schedule_lines for all to service_role using (true) with check (true);

comment on table public.accounting_schedules is
  'Reviewer-controlled templates for expected close entries such as prepaid amortization.';
