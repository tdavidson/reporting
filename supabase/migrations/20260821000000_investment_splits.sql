-- Share splits — the corporate action a quoted holding cannot live without.
--
-- A split changes the share COUNT and the per-share PRICE, and changes the position's value
-- by nothing at all. That invariant is the whole design: a 2:1 forward split doubles the
-- shares and halves the price, so `shares x price` is identical either side of it.
--
-- WHY THIS IS A TRANSACTION AND NOT AN EDIT. The naive fix is to rewrite `shares_acquired` on
-- the original purchase rows. That destroys the record of what was actually bought, breaks the
-- tie-out against a subscription document, and silently changes every historical valuation the
-- position has ever reported. A split is an EVENT with a date; it belongs in the transaction
-- history like every other event, and the roll-up applies it to the rows it precedes.
--
-- WHY IT MATTERS MORE ONCE PRICES COME FROM A FEED. A human entering a mark enters the price
-- and the share count together and would notice the mismatch. A feed supplies only the price,
-- post-split, on its own schedule. Without this row the position's share count stays pre-split
-- while its price goes post-split, and the holding silently halves in value overnight — a
-- corrupted NAV that balances, reconciles, and is wrong.
--
-- No grants block: ALTER TABLE ADD COLUMN on an existing table, and table grants already cover
-- new columns. RLS on investment_transactions is unchanged.

alter table investment_transactions
  drop constraint if exists investment_transactions_transaction_type_check;

alter table investment_transactions
  add constraint investment_transactions_transaction_type_check
  check (transaction_type in (
    'investment', 'proceeds', 'unrealized_gain_change', 'round_info', 'split'
  ));

-- New shares per old share. A 2-for-1 forward split is 2; a 1-for-10 reverse split is 0.1.
-- Fractional on purpose: reverse splits and 3-for-2 splits are both ordinary.
alter table investment_transactions
  add column if not exists split_ratio numeric;

alter table investment_transactions
  drop constraint if exists investment_transactions_split_ratio_positive;

alter table investment_transactions
  add constraint investment_transactions_split_ratio_positive
  check (split_ratio is null or split_ratio > 0);

-- A split row is nothing WITHOUT its ratio — it would be a no-op that looks like an event.
-- Enforced here rather than in the route so an import or an MCP tool cannot write one either.
alter table investment_transactions
  drop constraint if exists investment_transactions_split_requires_ratio;

alter table investment_transactions
  add constraint investment_transactions_split_requires_ratio
  check (transaction_type <> 'split' or split_ratio is not null);

-- A split with no date cannot be placed in the transaction history, so the roll-up could not
-- know which rows precede it. Undated is valid for every other type; for this one it is not.
alter table investment_transactions
  drop constraint if exists investment_transactions_split_requires_date;

alter table investment_transactions
  add constraint investment_transactions_split_requires_date
  check (transaction_type <> 'split' or transaction_date is not null);

comment on column investment_transactions.split_ratio is
  'New shares per old share on a split row. 2-for-1 forward = 2; 1-for-10 reverse = 0.1. '
  'Applies to rows dated STRICTLY BEFORE this row''s transaction_date: shares are multiplied '
  'by the ratio and per-share prices divided by it, leaving position value unchanged.';
