-- Interest on convertible notes, accrued at each close.
--
-- A note earns interest whether or not anybody books it. Not accruing it understates the fund's
-- income and understates the position's carrying value — and then, at conversion, the interest
-- silently appears inside the equity's cost basis with no history of where it came from.
--
-- SHAPE: identical to the carried-interest accrual (lib/accounting/carry.ts). At each close,
-- compute the TARGET accrual from the note's terms and the time elapsed, compare it to what is
-- already accrued in the ledger, and post the difference. Recomputing the target from scratch
-- means the accrual is self-correcting: fix a wrong rate and the next close repairs the balance
-- rather than compounding the error.
--
-- WHERE IT LANDS: Dr `1150-<company>` Accrued interest (an asset, per company)
--                 Cr `4100` Interest income
-- Interest income, NOT an unrealized mark: money the note has genuinely earned is investment
-- income, and an LP must be able to see it apart from what the valuation did. Same reason FX has
-- its own line.
--
-- ON CONVERSION: the accrued interest becomes part of the equity's cost basis —
--   Dr `1100-<company>` / Cr `1150-<company>` — which is exactly what
-- `investment_transactions.interest_converted` already records on the tracker side.

alter table public.investment_transactions
  -- CONVERTIBLE NOTE INTEREST ONLY. Annual simple rate as a fraction; 0.08 = 8%.
  -- NULL = bears no interest, which is the default and covers equity and SAFEs.
  add column if not exists interest_rate numeric
    check (interest_rate is null or (interest_rate >= 0 and interest_rate < 1)),

  -- Interest stops at maturity. Past it, an unconverted note is renegotiated in practice, and
  -- continuing to accrue would book income nobody is owed. NULL = accrue until conversion.
  add column if not exists maturity_date date,

  -- PREFERRED DIVIDENDS — AND THIS ONE DOES NOT TOUCH THE BOOKS.
  --
  -- Cumulative dividends on preferred equity accrue toward the LIQUIDATION PREFERENCE. They
  -- change what the position is worth in a waterfall, but they are not earned income until
  -- declared, and under fair-value accounting their effect reaches the statements through the
  -- MARK (1200/4200) — which is where a change in what the position is worth belongs.
  --
  -- Booking them as interest income would overstate income AND double-count against the mark.
  -- So this rate is recorded for the liquidation preference and is deliberately invisible to
  -- the ledger. `interest_rate` is the only rate the accrual ever reads.
  add column if not exists dividend_rate numeric
    check (dividend_rate is null or (dividend_rate >= 0 and dividend_rate < 1));

comment on column public.investment_transactions.interest_rate is
  'Annual simple interest rate on a CONVERTIBLE NOTE, as a fraction (0.08 = 8%). NULL = bears no '
  'interest. Accrued actual/365 from transaction_date to the earlier of maturity_date and '
  'conversion, by lib/accounting/note-interest.ts. Do NOT use for preferred dividends — see '
  'dividend_rate.';

comment on column public.investment_transactions.dividend_rate is
  'Cumulative dividend rate on PREFERRED EQUITY, as a fraction. Accrues toward the liquidation '
  'preference. DOES NOT HIT THE BOOKS: an undeclared preferred dividend is not income, and its '
  'economic effect reaches the statements through the fair-value mark. The ledger never reads '
  'this column.';

-- Interest income, for funds whose chart predates it. `4100` is Equity in earnings of Fund on
-- the GP chart, so the fund chart uses it for interest — see DEFAULT_CHART in chart.ts, which is
-- the source of truth. Re-syncing the chart adds any account a vehicle is missing.
