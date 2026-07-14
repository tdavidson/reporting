-- Two closed periods may not overlap. Enforced in the database, not just in app code.
--
-- `closeThrough` and the legacy `closePeriod` both check for overlap in TypeScript, but the
-- check and the insert are separate statements — two concurrent closes of overlapping spans
-- can both pass the check and both commit. `fiscal_periods` only had a unique constraint on
-- the EXACT range, which catches an identical duplicate and nothing else.
--
-- An overlap is not cosmetic: allocation entries in the intersection would be counted by both
-- periods, so a partner's capital would be allocated the same income twice, and reopening one
-- period would void entries the other still depends on.
--
-- Only CLOSED periods are constrained. An open period is a work-in-progress and may legitimately
-- overlap while a close is being prepared.

create extension if not exists btree_gist;

alter table public.fiscal_periods
  add constraint fiscal_periods_no_overlapping_closed
  exclude using gist (
    fund_id with =,
    vehicle_id with =,
    daterange(period_start, period_end, '[]') with &&
  )
  where (status = 'closed');
