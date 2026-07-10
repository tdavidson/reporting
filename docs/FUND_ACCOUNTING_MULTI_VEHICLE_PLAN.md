# Multi-vehicle accounting + vehicle onboarding — build plan

*Status: **built**. Pairs with `FUND_ADMIN_VISION.md`.*

> **Done:** all six items below are built behind the `accounting` flag. Ledger tables are scoped by
> `(fund_id, portfolio_group)`; the data layer, every API route, and the agent tools thread a
> vehicle; the Accounting section has a vehicle selector. Bootstrap, revaluation, XLS/PDF ingestion,
> snapshot reconcile, and a full-history-vs-cutover onboarding checklist all ship. Typecheck clean,
> 86 unit tests pass, production build compiles. Migrations were updated in place (unapplied) to add
> `portfolio_group` — if you already ran `supabase db push`, switch them to an additive ALTER.

## Why

The ledger was scoped to `fund_id` (the company). But the platform models each vehicle — an SPV,
Fund I, Fund II — as a `portfolio_group` under one `fund_id` (see `lp_investments`,
`fund_cash_flows`, `fund_group_config`). A company with an SPV **and** a fund needs **separate books
per vehicle**. So the ledger must be scoped by `(fund_id, portfolio_group)`, and onboarding must
support both **full-history reconstruction** (the SPV, back to 2021) and a **cutover opening balance**
(other vehicles).

## The build, in order

### 1. Vehicle scoping (foundation)
- Add `portfolio_group` to `chart_of_accounts`, `fiscal_periods`, `journal_entries`,
  `journal_postings`, `allocation_runs`, `allocation_results`, `bank_transactions`. Scope every
  uniqueness/index by `(fund_id, portfolio_group)`.
- Thread a `group` argument through the DB layer (`load`, `persist`, `allocation-actions`,
  `bank-import`, `bank-match`, `categorize-run`) — filter reads and stamp writes. Pure logic is
  unchanged (it operates on the rows it's handed).
- `loadOwnership` / `loadEntityNames` filter to the vehicle's LPs via `lp_investments.portfolio_group`.
- `/api/accounting/vehicles` lists the company's vehicles; a **vehicle selector** in the Accounting
  UI sets `?group=`; every route reads it. Agent tools/MCP take a `vehicle` argument (default when a
  single vehicle exists).

### 2. Bootstrap from existing LP data
- `/api/accounting/bootstrap` reads the vehicle's `lp_investments` (commitment, paid_in_capital,
  distributions) and generates the per-LP opening position — a **cutover opening-balance** entry
  (paid-in − distributions per LP) as of a chosen date. The ~25 LPs are already in the platform, so
  no re-entry.

### 3. Investment cost + periodic revaluation
- Record the investment at cost, then a **Revalue** action per mark date: delta vs the current
  carrying value (cost + prior unrealized) books unrealized gain/loss allocated per LP through the
  bridge (`source_type: valuation`), walking NAV forward. Hangs off `investment_valuations`.

### 4. XLS + PDF ingestion
- Bank import accepts `.xlsx` uploads (parsed via the `xlsx` dep → the same importer).
- Draft-from-document accepts PDF uploads (text via `unpdf` → the existing AI draft).

### 5. Reconcile against the LP snapshot
- The reconcile "answer key" is the LP data already in the platform: pull the vehicle's
  `lp_investments` figures as the admin comparison (contributions, distributions, ending) instead of
  pasting them.

### 6. Vehicle onboarding checklist
- A vehicle-scoped setup flow: pick vehicle → seed chart → **choose full-history or cutover** →
  bootstrap/import → set investment + revalue → reconcile → go live.

## Onboarding paths

- **Full history (this SPV):** seed chart → import bank history (CSV/XLS, dated) → categorize →
  match inflows to calls, outflows to the investment purchase/expenses/distributions → enter
  revaluations → reconcile capital accounts against the LP snapshot. `lp_investments` is the check,
  the bank feed is the dated history.
- **Cutover (other vehicles / new fund):** seed chart → bootstrap opening balances from LP data as
  of a date → run forward. A brand-new fund needs no history — book from first close.
