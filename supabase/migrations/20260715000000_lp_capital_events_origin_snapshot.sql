-- Track which LP snapshot a capital event was COPIED from.
--
-- The cutover copies the latest LP snapshot into each vehicle's `lp_capital_events`, so
-- capital tracking runs off the vehicles instead of an imported spreadsheet. That copy has
-- to be safe to run twice and safe to undo, because the first run will be wrong somewhere
-- and the whole point is to check it against the snapshot before trusting it.
--
-- `origin_snapshot_id` buys three things at once:
--   • Idempotency  — the unique index below makes a second run a no-op, not a double-count.
--                    Doubling every LP's capital is the failure mode here, and it is silent.
--   • Undo         — `delete from lp_capital_events where origin_snapshot_id = $1` reverses
--                    the entire import exactly, touching nothing that was hand-entered.
--   • Provenance   — copied rows stay distinguishable from hand-entered ones forever. When
--                    a number is later questioned, "this came from the March snapshot" is
--                    the answer that ends the argument.
--
-- NULL = entered directly (by hand, or by an agent). Only the cutover sets it.

alter table public.lp_capital_events
  add column if not exists origin_snapshot_id uuid
    references public.lp_snapshots(id) on delete set null;

-- One row per (vehicle, LP, source_type) per snapshot. The cutover writes at most three
-- rows per LP per vehicle — the recognized capital, the distributions, and the valuation
-- plug that makes the ending balance tie to the snapshot's NAV — so this is exactly the
-- grain of the import. A partial index, so it constrains only copied rows and leaves
-- hand-entered events (origin_snapshot_id is null) completely unconstrained: an LP can
-- have as many real contributions as they like.
create unique index if not exists lp_capital_events_origin_unique
  on public.lp_capital_events (fund_id, vehicle_id, lp_entity_id, source_type, origin_snapshot_id)
  where origin_snapshot_id is not null;

create index if not exists lp_capital_events_origin_idx
  on public.lp_capital_events (origin_snapshot_id)
  where origin_snapshot_id is not null;

comment on column public.lp_capital_events.origin_snapshot_id is
  'The lp_snapshot this event was copied from by the capital cutover. NULL = entered directly. Delete by this column to reverse an import.';
