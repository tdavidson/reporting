-- Preserve the sub-cent entitlement behind each period-close allocation. Journal postings remain
-- cent-denominated; the next close carries exact_amount - posted_amount forward so the same LP
-- does not systematically receive every rounding cent.
create table public.close_allocation_rounding (
  id                uuid primary key default gen_random_uuid(),
  fund_id           uuid not null references public.funds(id) on delete cascade,
  vehicle_id        uuid not null references public.fund_vehicles(id) on delete cascade,
  fiscal_period_id  uuid not null references public.fiscal_periods(id) on delete cascade,
  source_type       text not null,
  lp_entity_id      uuid not null references public.lp_entities(id) on delete cascade,
  exact_amount      numeric(30, 12) not null,
  posted_amount     numeric(20, 2) not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (fiscal_period_id, source_type, lp_entity_id)
);

create index close_allocation_rounding_history_idx
  on public.close_allocation_rounding (fund_id, vehicle_id, source_type, lp_entity_id, fiscal_period_id);

create trigger set_close_allocation_rounding_updated_at
  before update on public.close_allocation_rounding
  for each row execute function public.set_updated_at();

grant select on public.close_allocation_rounding to anon;
grant select, insert, update, delete on public.close_allocation_rounding to authenticated, service_role;

alter table public.close_allocation_rounding enable row level security;

create policy "close allocation rounding read needs accounting"
  on public.close_allocation_rounding for select to authenticated
  using (fund_id = any(public.fund_ids_readable('accounting')));

create policy "close allocation rounding insert needs accounting write"
  on public.close_allocation_rounding for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('accounting')));

create policy "close allocation rounding update needs accounting write"
  on public.close_allocation_rounding for update to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')))
  with check (fund_id = any(public.fund_ids_writable('accounting')));

create policy "close allocation rounding delete needs accounting write"
  on public.close_allocation_rounding for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')));

comment on table public.close_allocation_rounding is
  'Exact and posted partner shares for each period-close category; closed history supplies cumulative sub-cent rounding residuals.';
