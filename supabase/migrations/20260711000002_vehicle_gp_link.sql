-- Link a GP / associate entity (its own set of books) to the fund vehicle it
-- serves, so accounting tools can pull the fund's books together with its GP
-- entity's books (which reconcile to each other). Null for ordinary vehicles.
alter table public.fund_vehicles
  add column if not exists serves_vehicle_id uuid references public.fund_vehicles(id) on delete set null;

create index if not exists fund_vehicles_serves_idx on public.fund_vehicles (serves_vehicle_id);
