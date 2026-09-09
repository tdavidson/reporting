-- Track cash releases from an escrow balance separately from the original exit.
-- The original proceeds row remains the gross realization (cash + escrow); an escrow_receipt
-- row records when part of that receivable is actually collected without counting it twice.
alter table public.investment_transactions
  drop constraint if exists investment_transactions_transaction_type_check;

alter table public.investment_transactions
  add constraint investment_transactions_transaction_type_check
  check (transaction_type in (
    'investment', 'proceeds', 'escrow_receipt', 'unrealized_gain_change', 'round_info', 'split', 'income'
  ));
