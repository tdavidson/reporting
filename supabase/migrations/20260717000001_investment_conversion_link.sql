-- A SAFE / convertible-note conversion is recorded as the priced-round investment it becomes
-- (e.g. a Series A), linked back to the instrument it converted from. The link lets the tracker
-- move the converted instrument's basis into the new round (instead of double-counting it), and
-- lets the ledger post the conversion as a non-cash reclass + a step-up dated on the conversion
-- date rather than the original SAFE/note date.
--
-- No new transaction_type: a conversion IS an `investment` row (round = the priced round),
-- distinguished only by a non-null converts_from_txn_id. So the existing CHECK constraint, the
-- Data API grants, and RLS on this table are all unchanged.
alter table public.investment_transactions
  add column if not exists converts_from_txn_id uuid
    references public.investment_transactions(id) on delete set null;

comment on column public.investment_transactions.converts_from_txn_id is
  'When set, this investment row is the conversion of the referenced SAFE/note transaction into this priced round. Its investment_cost is NEW cash only; the source instrument''s cost basis (plus any interest_converted) carries into this round at the conversion date.';

create index if not exists investment_transactions_converts_from_idx
  on public.investment_transactions (converts_from_txn_id)
  where converts_from_txn_id is not null;
