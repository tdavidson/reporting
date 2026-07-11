# Setting up accounting for an entity (vehicle)

How to stand up the books for a vehicle — a brand-new fund, or an entity that already exists on the
platform. In this system a **vehicle is a `portfolio_group`**: `fund_id` is the company/installation,
and each SPV / Fund I / Fund II is a `portfolio_group` under it, with its **own separate books**
(chart, ledger, capital accounts, bank feed, periods).

## Prerequisites (all scenarios)

1. **Enable Accounting.** Settings → *Feature visibility* → set **Accounting** to `admin` (it ships
   `off`). It's admin-only.
2. **Apply the migrations** (`supabase db push`) so the ledger tables exist. If you'd already applied
   an earlier version of these migrations, convert the `portfolio_group` / period columns to an
   additive `ALTER` first.
3. **LP + commitment data must exist for the vehicle.** The allocation basis and the reconcile
   answer-key come from `lp_investments` (investors → entities → commitment/paid-in/distributions per
   `portfolio_group`). A vehicle only appears in the Accounting **vehicle selector** once it has LP
   data, a fund-group config, or cash flows for that `portfolio_group`. If the entity is already on
   the platform (e.g. built from an LP report snapshot), this is already done.

Then, in every scenario: **pick the vehicle** in the selector at the top of the Accounting section —
everything you do scopes to it.

---

## Scenario A — an existing entity already on the platform (e.g. the SPV)

The entity's LPs, commitments, and prior figures are already in the platform. You choose how much
history to bring in. Both paths start the same:

- Accounting → **home** → **Seed the chart of accounts** (one click).

### A1. Full history (reconstruct from inception) — recommended for the SPV

Best when volume is low and you want a complete, auditable trail.

1. **Bank transactions** → paste or **Upload CSV/XLS** of the bank history from inception. Rows are
   deduped and each drafts a balanced entry.
2. **Categorize with AI** to classify the fuzzy rows against the chart.
3. For each inflow that's a capital call, **Book as call** (allocates per LP by commitment) or
   **Match call** if you already recorded it. Post the drafts.
4. **Book the investment purchase** on the **Plain text** page (rare, so it's a text entry):
   `Dr Assets:Investments-At-Cost:1100 / Cr Assets:Cash:1000`.
5. Record each periodic mark: **Allocations → Revalue investment** (enter the new fair value; the
   unrealized change allocates per LP and moves NAV).
6. **Reconcile** → *Load from LP snapshot* to prefill the answer-key from `lp_investments`, then
   reconcile the ledger capital accounts against it. Use the statements **As of** control to tie out
   at each historical date.
7. **Close & lock** each completed period (see "Going live").

### A2. Cutover opening balance

Best for other vehicles where reconstructing history isn't worth it.

1. Accounting → home → choose **Cutover opening balance** → pick the cutover date → **Bootstrap
   opening balances**. This reads the vehicle's `lp_investments` and books, as of that date,
   `Dr Cash / Cr each LP's capital` for paid-in − distributions. (Capital in nets against cash.)
2. **Book the investment purchase** in Plain text so cash moves into the investment
   (`Dr 1100 / Cr 1000`), leaving ending cash = paid-in − cost.
3. Run forward from the cutover: book new calls/distributions/fees/marks as they happen.

---

## Scenario B — a brand-new fund/entity in the same company

Greenfield: no history to reconstruct — you're the book of record from first close.

1. **Create the vehicle's LP data first** so it appears in the selector: in the **LPs** section add
   the investors/entities and their commitments under the new `portfolio_group` (or import them).
   Set the vehicle's economics (carry, GP commit, vintage) on the **Funds** page (`fund_group_config`).
2. Pick the new vehicle → Accounting → home → **Seed the chart of accounts**.
3. Book from **first close forward**:
   - **Capital call**: import the wire from the bank feed and *Book as call*, or use
     **Allocations → (record the call)** — either way it's `Dr Cash / Cr each LP capital`.
   - **Investment purchase**: Plain text (`Dr 1100 / Cr 1000`).
   - **Management fee / expenses / gains**: Allocations actions as they occur.
   - **Revalue** at each reporting date.
4. Reconcile cash against the bank feed; close & lock each period.

No bootstrap and no historical import — you simply start posting.

---

## Scenario C — a brand-new company / fresh install

1. Deploy against a fresh Supabase project and run all migrations.
2. Complete onboarding to create the fund and the first admin user (`fund_members`).
3. Create the first vehicle's LP data (Scenario B, step 1), then follow Scenario A or B per vehicle.

Everything is per-vehicle from there, so the same company can run an SPV and a fund side by side.

---

## Going live & keeping the books

- **Period close (P&L):** Allocations → **Close period** zeroes income/expense into the
  undistributed-earnings bridge. (Capital accounts are already current.)
- **Lock the period:** **Periods** → *Close & lock* the date range. This snapshots the whole ledger
  as plain-text double-entry (the audit record) and **blocks any new posting dated inside the range**
  until you reopen it.
- **Amend a closed period:** Periods → *Reopen*, post the fix, close & lock again.
- **Statements at any date:** the **Financial statements** page has an *As of* control so every
  statement can be viewed at a chosen date.

## Verify the setup is correct

Use the checklist in `FUND_ACCOUNTING_ENTRIES.md`, in short:

- Every entry balances; the trial balance shows equal debits and credits.
- Assets = Liabilities + Partners' capital (balance-sheet `check` is 0 after the period close).
- Fund NAV (Capital accounts) = equity total on the balance sheet = sum of LP ending capital.
- After a period close, the bridge (3200) and the income/expense accounts are 0.
- Reconciliation *Load from LP snapshot* matches contributions to paid-in and distributions.
- Bank reconciliation: ledger cash = the bank feed's ending balance once every row is matched.
- Switching the vehicle selector changes every figure (per-vehicle isolation).

## Agents

Everything above is also available to agents over MCP/REST (Settings → *Agent access*): seed the
chart, import a bank feed, categorize, book calls, revalue, author entries as text, reconcile, and
close periods — each scoped to a vehicle via the `vehicle` argument.
