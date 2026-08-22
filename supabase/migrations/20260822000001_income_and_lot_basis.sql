-- Two gaps that both bite the same way: they quietly turn income into gain.
--
-- 1. INCOME IN KIND. A staking reward, an airdrop, a stock dividend. Today the only way to
--    record one is a valuation update, which books it as APPRECIATION — and appreciation is
--    not income. It inflates the unrealized line, distorts every MOIC on the page, and never
--    appears on the statement of operations where an LP would look for yield.
--
--    Worse, it double-counts on exit. Rewards received in kind are recognised at fair value on
--    receipt, and that value BECOMES their cost basis. Recorded as a mark instead, the basis
--    stays zero, and selling them later reports the whole proceeds as gain — income recognised
--    once as appreciation and again as realised gain.
--
-- 2. LOT BASIS. Selling part of a fungible position needs to know WHICH purchase the units
--    left. `cost_basis_exited` is typed by hand and defaults to nothing, so a partial disposal
--    with the field left blank keeps the full cost on the books and reports the entire proceeds
--    as gain. The lot method is a policy election; recording it is what lets the number be
--    computed rather than guessed.

-- ---------------------------------------------------------------------------
-- 1. The income transaction type.
-- ---------------------------------------------------------------------------
alter table investment_transactions
  drop constraint if exists investment_transactions_transaction_type_check;

alter table investment_transactions
  add constraint investment_transactions_transaction_type_check
  check (transaction_type in (
    'investment', 'proceeds', 'unrealized_gain_change', 'round_info', 'split', 'income'
  ));

-- What produced the income. Kept apart because they hit different lines: a dividend is
-- interest-and-dividend income, staking and airdrops are portfolio income the position itself
-- generated. 'interest' is deliberately absent — note interest already accrues at the close
-- (20260714000007), and a second path would double-count it.
alter table investment_transactions
  add column if not exists income_kind text;

alter table investment_transactions
  drop constraint if exists investment_transactions_income_kind_check;

alter table investment_transactions
  add constraint investment_transactions_income_kind_check
  check (income_kind is null or income_kind in ('staking', 'airdrop', 'dividend', 'other'));

-- How it settled, which decides what the entry debits. Cash income lands in the bank and
-- changes no position; in-kind income lands in the POSITION — more units, and their fair value
-- on the day becomes their cost.
alter table investment_transactions
  add column if not exists income_settlement text;

alter table investment_transactions
  drop constraint if exists investment_transactions_income_settlement_check;

alter table investment_transactions
  add constraint investment_transactions_income_settlement_check
  check (income_settlement is null or income_settlement in ('cash', 'in_kind'));

-- Fair value on the day it was received. Its own column rather than reusing investment_cost:
-- an airdrop is not capital the fund deployed, and folding it into invested capital would
-- understate every MOIC by treating a windfall as a cheque the fund wrote.
alter table investment_transactions
  add column if not exists income_amount numeric;

alter table investment_transactions
  drop constraint if exists investment_transactions_income_amount_check;

alter table investment_transactions
  add constraint investment_transactions_income_amount_check
  check (income_amount is null or income_amount >= 0);

-- An income row is nothing without its kind, its settlement, its amount and a date.
alter table investment_transactions
  drop constraint if exists investment_transactions_income_complete;

alter table investment_transactions
  add constraint investment_transactions_income_complete
  check (
    transaction_type <> 'income'
    or (income_kind is not null and income_settlement is not null
        and income_amount is not null and transaction_date is not null)
  );

-- In-kind income must say how many units arrived: the units ARE the income, and a row without
-- them recognises a value that landed nowhere.
alter table investment_transactions
  drop constraint if exists investment_transactions_in_kind_needs_units;

alter table investment_transactions
  add constraint investment_transactions_in_kind_needs_units
  check (
    transaction_type <> 'income' or income_settlement <> 'in_kind'
    or (shares_acquired is not null and shares_acquired > 0)
  );

comment on column investment_transactions.income_amount is
  'Fair value of income on the day received. For in-kind income this also becomes the cost '
  'basis of the units, so a later sale does not report it as gain a second time.';

-- ---------------------------------------------------------------------------
-- 2. Acquisition costs.
-- ---------------------------------------------------------------------------
-- Gas, brokerage, a transfer fee — costs of ACQUIRING a position, which capitalise into its
-- basis rather than hitting the income statement. Its own column so the disclosure survives:
-- folded into investment_cost the fee is real but invisible, and nobody can answer "what did
-- we pay in gas last year" without re-reading every row.
--
-- Costs that are NOT acquisition costs — gas on a transfer between the fund's own wallets,
-- a failed transaction, wallet or custody fees — are partnership expenses and belong on the
-- journal, not on a position. There is deliberately nowhere to put them here.
alter table investment_transactions
  add column if not exists fee_amount numeric;

alter table investment_transactions
  drop constraint if exists investment_transactions_fee_amount_check;

alter table investment_transactions
  add constraint investment_transactions_fee_amount_check
  check (fee_amount is null or fee_amount >= 0);

comment on column investment_transactions.fee_amount is
  'Acquisition cost capitalised into basis (gas, brokerage). NOT for transfer gas or custody '
  'fees, which are partnership expenses and belong on the journal.';

-- ---------------------------------------------------------------------------
-- 3. The lot method.
-- ---------------------------------------------------------------------------
-- Which purchase a disposal draws its basis from. A policy election, not a calculation: the
-- fund picks one and applies it consistently, and the point of recording it is that the basis
-- can then be COMPUTED and checked rather than typed and hoped for.
--
-- Default 'fifo' because it is the common election and the assumption a fund falls into by
-- default anyway. 'specific' is absent on purpose — identifying lots by hand needs a per-
-- disposal lot selection this schema does not carry, and offering it without that would let a
-- fund elect a method the software cannot actually apply.
alter table public.fund_settings
  add column if not exists lot_method text not null default 'fifo';

alter table public.fund_settings
  drop constraint if exists fund_settings_lot_method_check;

alter table public.fund_settings
  add constraint fund_settings_lot_method_check
  check (lot_method in ('fifo', 'lifo', 'hifo', 'average'));

comment on column public.fund_settings.lot_method is
  'Which purchase lot a disposal draws cost basis from: fifo, lifo, hifo (highest cost first) '
  'or average. Applied to compute a proposed basis; the recorded cost_basis_exited still wins.';
