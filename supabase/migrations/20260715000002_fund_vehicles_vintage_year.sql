-- Vintage year, on the vehicle.
--
-- It lived on `fund_group_config`, keyed by the free-text portfolio_group name, alongside
-- `carry_rate` and `gp_commit_pct`. Those two are gone: carry terms now live in
-- `vehicle_waterfall_terms` (a real per-vehicle waterfall, with a pref and a catch-up), and
-- `gp_commit_pct` existed only to feed the old Funds page's carry ESTIMATE — which is
-- obsolete, because the close accrues real carry into real capital accounts.
--
-- Vintage is different. It is not a parameter of a calculation anyone can now derive; it is
-- a FACT about the vehicle that nothing else knows. So it moves onto `fund_vehicles`, where
-- the rest of a vehicle's identity lives, rather than being retired with the calculation it
-- happened to sit next to.

alter table public.fund_vehicles
  add column if not exists vintage_year integer
    check (vintage_year is null or (vintage_year >= 1900 and vintage_year <= 2200));

-- Carry over whatever was already recorded, matching on the name the old table was keyed by.
-- Best-effort: `fund_group_config` may not exist on a fresh install, and a vehicle whose
-- name never matched a config row simply keeps a null vintage.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'fund_group_config'
  ) then
    update public.fund_vehicles fv
      set vintage_year = fgc.vintage
      from public.fund_group_config fgc
     where fgc.fund_id = fv.fund_id
       and fgc.portfolio_group = fv.name
       and fgc.vintage is not null
       and fv.vintage_year is null;
  end if;
end $$;

comment on column public.fund_vehicles.vintage_year is
  'The vehicle''s vintage year. Migrated off fund_group_config.vintage, which was keyed by the free-text group name.';
