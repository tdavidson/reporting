-- Repair: the commitment_events backfill multiplied every commitment by the snapshot count.
--
-- `20260713000000_allocation_terms_and_commitments.sql` seeded one 'initial' event per
-- `lp_investments` row. But lp_investments is unique per (fund, entity, group, SNAPSHOT)
-- — one row per LP *per snapshot* — so a fund with N snapshots got N 'initial' events per
-- LP, and `commitmentsAsOf()` sums them. Every close allocating on commitment_events has
-- been using N x each LP's real commitment.
--
-- The companion code fix (lib/accounting/load.ts `loadOwnership`) stops the same summing
-- on the lp_investments scalar path. This migration repairs the event history the close
-- reads.
--
-- SAFETY: this only ever touches rows that still exactly match the backfill's own
-- fingerprint — kind='initial', effective_date=1970-01-01, and the verbatim backfill memo.
-- A commitment event you recorded by hand, or a backfilled row whose date you have since
-- corrected, does not match and is left alone. Nothing here is derived from user input:
-- the replacement rows are recomputed from lp_investments, so re-running the original
-- backfill statement would reconstruct the deleted rows exactly.

begin;

-- 1. Remove the backfill artifacts, but ONLY for (fund, vehicle, lp_entity) triples that
--    actually got duplicated. An LP in a single-snapshot fund got exactly one event, which
--    is already correct — leave it untouched rather than churn it.
with backfilled as (
  select
    id,
    fund_id,
    vehicle_id,
    lp_entity_id,
    count(*) over (partition by fund_id, vehicle_id, lp_entity_id) as n
  from public.commitment_events
  where kind = 'initial'
    and effective_date = date '1970-01-01'
    and memo = 'Backfilled from lp_investments — verify the subscription date'
)
delete from public.commitment_events ce
using backfilled b
where ce.id = b.id
  and b.n > 1;

-- 2. Re-seed exactly one 'initial' event per (fund, vehicle, lp_entity) for the triples we
--    just cleared, taking the commitment from the LATEST snapshot by as_of_date — the same
--    rule loadOwnership now uses, so the ledger and the scalar path agree.
--
--    `where not exists (...)` makes this idempotent and keeps us from stomping an entity
--    whose 'initial' event survived step 1 (either it was never duplicated, or you had
--    already corrected it and it no longer matches the fingerprint).
insert into public.commitment_events (fund_id, vehicle_id, lp_entity_id, effective_date, amount, kind, memo)
select distinct on (li.fund_id, fv.id, li.entity_id)
  li.fund_id,
  fv.id,
  li.entity_id,
  date '1970-01-01',
  li.commitment,
  'initial',
  'Backfilled from lp_investments — verify the subscription date'
from public.lp_investments li
join public.fund_vehicles fv
  on fv.fund_id = li.fund_id and fv.name = li.portfolio_group
left join public.lp_snapshots s
  on s.id = li.snapshot_id
where li.commitment is not null
  and li.commitment <> 0
  and not exists (
    select 1 from public.commitment_events ce
    where ce.fund_id = li.fund_id
      and ce.vehicle_id = fv.id
      and ce.lp_entity_id = li.entity_id
      and ce.kind = 'initial'
  )
order by
  li.fund_id, fv.id, li.entity_id,
  -- Latest snapshot wins; unsnapshotted rows are the last resort (nulls last).
  s.as_of_date desc nulls last,
  s.created_at desc nulls last,
  li.updated_at desc nulls last;

-- 3. Make the bug structurally impossible to reintroduce. One 'initial' commitment per
--    partner per vehicle is a real invariant — subsequent changes are 'increase' /
--    'decrease' / 'transfer_*' events, which are legitimately many-per-partner.
create unique index if not exists commitment_events_one_initial_per_partner
  on public.commitment_events (fund_id, vehicle_id, lp_entity_id)
  where kind = 'initial';

commit;
