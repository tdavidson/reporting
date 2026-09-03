-- Split "Interest and dividend income" into two accounts, because they are two K-1 boxes.
--
-- Interest is box 5; dividends are box 6a, with the qualified portion in 6b. One account for
-- both meant the tax side had to INFER the split — subtract tagged portfolio income from the
-- account total and call the remainder interest — which silently misclassified any dividend
-- booked straight to the ledger by a journal entry or a bank rule, with no portfolio row behind
-- it. The account is the auditable source; the portfolio tag is a cross-check against it.
--
-- Chart sync is additive (app/api/accounting/chart/route.ts): it inserts codes a vehicle lacks
-- and never touches existing rows. So 4130 arrives on the next sync, but 4100 would keep its old
-- name forever, and two vehicles seeded a month apart would disagree about what 4100 means. This
-- migration renames it — and ONLY where it still carries the shipped default name, so a fund that
-- renamed the account for its own reasons is left alone.

update public.chart_of_accounts
   set name = 'Interest income',
       subtype = coalesce(subtype, 'interest_income')
 where code = '4100'
   and name = 'Interest and dividend income';

-- WHAT THIS MIGRATION CANNOT DO, said plainly rather than left to be discovered: it does not
-- reclassify history. Postings already sitting in 4100 may be dividends, and nothing in the
-- ledger records which. They stay where they are and will report as interest.
--
-- Reclassifying them is a judgment call about specific transactions, so it belongs to whoever
-- knows the answer, as a journal entry. The K-1 loader surfaces the discrepancy rather than
-- hiding it: when tagged dividend income exists for a year but 4130 does not hold it, that
-- mismatch is reported.
