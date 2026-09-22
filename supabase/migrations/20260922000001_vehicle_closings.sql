-- Closings: when a vehicle admitted its partners.
--
-- Until now a partner's admission was whatever date someone typed on their first commitment
-- event — and most vehicles keep commitment as a scalar on lp_investments with no events at all,
-- so for them it was nothing. A closing is the fact the rest of the platform has needed: the
-- onboarding checklist has a deadline ("complete before Second Close on Jun 30"), and the two
-- things the ledger will eventually want — a management-fee commencement date and late-closer
-- equalisation — have a date to read rather than a convention to guess at. Neither of those is
-- built here; this is the prerequisite, kept deliberately small.
--
-- Two tables. A closing is named and dated per vehicle. Its members are the entities admitted
-- at it — one row per (closing, entity), an entity in two vehicles being admitted at a close of
-- each. Membership is the record of admission; it does not create or change a commitment.

create table public.vehicle_closings (
  id          uuid primary key default gen_random_uuid(),
  fund_id     uuid not null references funds(id) on delete cascade,
  vehicle_id  uuid not null references fund_vehicles(id) on delete cascade,
  -- "First Close", "Second Close", "Final Close" — whatever the LPA calls it.
  name        text not null,
  close_date  date not null,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (vehicle_id, name)
);
create index vehicle_closings_vehicle_idx on public.vehicle_closings (fund_id, vehicle_id, close_date);

create table public.vehicle_closing_members (
  id            uuid primary key default gen_random_uuid(),
  fund_id       uuid not null references funds(id) on delete cascade,
  closing_id    uuid not null references public.vehicle_closings(id) on delete cascade,
  lp_entity_id  uuid not null references lp_entities(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (closing_id, lp_entity_id)
);
create index vehicle_closing_members_entity_idx on public.vehicle_closing_members (lp_entity_id);

-- Grants — required from 2026-05-30 onward for the Data API to see these tables.
grant select on public.vehicle_closings, public.vehicle_closing_members to anon;
grant select, insert, update, delete on public.vehicle_closings, public.vehicle_closing_members to authenticated, service_role;

alter table public.vehicle_closings enable row level security;
alter table public.vehicle_closing_members enable row level security;

-- Policies — lp_capital, like the commitment events they date (lib/access/table-domains.ts).
create policy "vehicle_closings read needs lp_capital"
  on public.vehicle_closings for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_capital')));
create policy "vehicle_closings insert needs lp_capital write"
  on public.vehicle_closings for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "vehicle_closings update needs lp_capital write"
  on public.vehicle_closings for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')))
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "vehicle_closings delete needs lp_capital write"
  on public.vehicle_closings for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')));

create policy "vehicle_closing_members read needs lp_capital"
  on public.vehicle_closing_members for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_capital')));
create policy "vehicle_closing_members insert needs lp_capital write"
  on public.vehicle_closing_members for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "vehicle_closing_members update needs lp_capital write"
  on public.vehicle_closing_members for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')))
  with check (fund_id = any(public.fund_ids_writable('lp_capital')));
create policy "vehicle_closing_members delete needs lp_capital write"
  on public.vehicle_closing_members for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_capital')));

-- An LP may read the closing their own entity was admitted at: the portal shows "needed before
-- Second Close on Jun 30". The portal goes through the service role; this is defence in depth.
create policy "vehicle_closing_members_select_own_entity"
  on public.vehicle_closing_members for select to authenticated
  using (lp_entity_id in (
    select e.id from public.lp_entities e where e.investor_id = any(public.get_my_lp_investor_ids())
  ));
create policy "vehicle_closings_select_own_entity"
  on public.vehicle_closings for select to authenticated
  using (id in (
    select m.closing_id from public.vehicle_closing_members m
    join public.lp_entities e on e.id = m.lp_entity_id
    where e.investor_id = any(public.get_my_lp_investor_ids())
  ));
