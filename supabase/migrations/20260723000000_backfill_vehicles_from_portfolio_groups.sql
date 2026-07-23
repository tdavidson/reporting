-- Backfill fund_vehicles from existing portfolio_group strings.
--
-- portfolio_group is being unified into the fund_vehicles registry: going forward every write path
-- (company save, investment save, import) calls ensureVehiclesByName so a vehicle name always has a
-- registry row. But data written BEFORE that change may carry portfolio_group strings with no
-- matching fund_vehicle (the importer used to mint bare strings). This backfill closes that gap for
-- existing data: for every distinct portfolio_group on companies + investment_transactions that has
-- no matching vehicle (by name or alias, case-insensitive), it creates a LIGHTWEIGHT vehicle
-- (kind 'other' — the uncategorized bucket; the user re-classifies to fund/SPV and adds LP/accounting
-- details later). Companies/transactions with no group are untouched — they simply have no vehicle.
--
-- Data-only INSERT into an existing table; no schema change and no new Data API grants required.
-- Idempotent: re-running creates nothing new (the not-exists guard + on-conflict handle it).

insert into public.fund_vehicles (fund_id, name, kind, aliases, active)
select src.fund_id, src.grp, 'other', '{}'::text[], true
from (
  -- One representative casing per (fund, lower(group)) so "Fund I" and "fund i" don't both create
  -- a row. Mirrors ensureVehiclesByName's case-insensitive matching.
  select distinct on (fund_id, lower(grp)) fund_id, grp
  from (
    select c.fund_id, trim(g) as grp
    from public.companies c, unnest(c.portfolio_group) as g
    where g is not null and trim(g) <> ''
    union all
    select t.fund_id, trim(t.portfolio_group) as grp
    from public.investment_transactions t
    where t.portfolio_group is not null and trim(t.portfolio_group) <> ''
  ) all_groups
  order by fund_id, lower(grp), grp
) src
where not exists (
  select 1
  from public.fund_vehicles v
  where v.fund_id = src.fund_id
    and (
      lower(trim(v.name)) = lower(src.grp)
      or exists (select 1 from unnest(v.aliases) a where lower(trim(a)) = lower(src.grp))
    )
)
on conflict (fund_id, name) do nothing;
