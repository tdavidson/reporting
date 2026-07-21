-- Many-to-many "GP of a vehicle": one GP/associate entity can be the GP of several vehicles.
--
-- Replaces the single `fund_vehicles.serves_vehicle_id` (+ `lp_entity_id`) columns, which could
-- only express "this associate serves ONE vehicle". A row here means: `gp_vehicle_id` (a GP/
-- associate entity with its own books) is a general partner OF `served_vehicle_id`, appearing in
-- that vehicle as partner `lp_entity_id`. Set from the served vehicle's side.
--
-- The old columns are kept for now (readers fall back to them if this table is empty / unapplied);
-- a later migration drops them once nothing reads them.

create table public.vehicle_gp_links (
  id                uuid primary key default gen_random_uuid(),
  fund_id           uuid not null references funds(id) on delete cascade,
  -- The GP/associate entity acting as GP (its own fund_vehicle with its own books).
  gp_vehicle_id     uuid not null references fund_vehicles(id) on delete cascade,
  -- The vehicle it is the GP OF.
  served_vehicle_id uuid not null references fund_vehicles(id) on delete cascade,
  -- As which partner the GP appears in the served vehicle (for reconciliation). Nullable.
  lp_entity_id      uuid references lp_entities(id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (gp_vehicle_id, served_vehicle_id)
);

create index if not exists vehicle_gp_links_served_idx on public.vehicle_gp_links (served_vehicle_id);
create index if not exists vehicle_gp_links_gp_idx on public.vehicle_gp_links (gp_vehicle_id);

-- 1. Grants — anon SELECT only; authenticated + service_role full CRUD (RLS scopes per row).
grant select on public.vehicle_gp_links to anon;
grant select, insert, update, delete on public.vehicle_gp_links to authenticated, service_role;

-- 2. RLS
alter table public.vehicle_gp_links enable row level security;

-- 3. Policies — fund members can read and manage their own fund's links.
create policy "Fund members read their fund's GP links"
  on public.vehicle_gp_links for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = vehicle_gp_links.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund members manage their fund's GP links"
  on public.vehicle_gp_links for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = vehicle_gp_links.fund_id and fm.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = vehicle_gp_links.fund_id and fm.user_id = auth.uid()
  ));

-- 4. Backfill: one link per existing single serves_vehicle_id.
insert into public.vehicle_gp_links (fund_id, gp_vehicle_id, served_vehicle_id, lp_entity_id)
select fund_id, id, serves_vehicle_id, lp_entity_id
from public.fund_vehicles
where serves_vehicle_id is not null
on conflict (gp_vehicle_id, served_vehicle_id) do nothing;
