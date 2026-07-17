# Fund accounting

- Project overview at [README](./README.md)
- Detailed feature descriptions at [FEATURES](./FEATURES.md)
- Technical deployment details at [DOCS](./DOCS.md)

Fund accounting is an **optional** double-entry ledger, off by default. Turn it on when you want LP
numbers to come from real books rather than pasted statements. This covers both halves: standing the
books up for a vehicle, and how every entry is booked once they're running.

In this system a **vehicle is a `portfolio_group`**: `fund_id` is the company/installation, and each
SPV / Fund I / Fund II is a `portfolio_group` under it, with its **own separate books** (chart,
ledger, capital accounts, bank feed, periods).

**Contents**

- [Setting up a vehicle](#setting-up-a-vehicle) — prerequisites and the three onboarding scenarios
- [Going live & keeping the books](#going-live--keeping-the-books)
- [Double-entry reference](#double-entry-reference) — how each entry type is booked
- [The capital-account roll-forward](#the-capital-account-roll-forward)
- [Verifying the books](#verifying-the-books) — the checks that should always hold
- [Authoring in text](#authoring-in-text)
- [Agents](#agents)

---

# Setting up a vehicle

How to stand up the books for a vehicle — a brand-new fund, or an entity that already exists on the
platform.

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
7. **Close & lock** each completed period (see [Going live](#going-live--keeping-the-books)).

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

# Going live & keeping the books

- **Period close (P&L):** Allocations → **Close period** zeroes income/expense into the
  undistributed-earnings bridge. (Capital accounts are already current.)
- **Lock the period:** **Periods** → *Close & lock* the date range. This snapshots the whole ledger
  as plain-text double-entry (the audit record) and **blocks any new posting dated inside the range**
  until you reopen it.
- **Amend a closed period:** Periods → *Reopen*, post the fix, close & lock again.
- **Statements at any date:** the **Financial statements** page has an *As of* control so every
  statement can be viewed at a chosen date.

---

# Double-entry reference

How every entry type is booked, in both T-account form and the plain-text double-entry format you
author in. Use this to write entries on the **Plain text** page and to verify the books are set up
correctly. Everything here matches what the entry builders in `lib/accounting/entries.ts` produce.

## The two rules that make it all work

1. **Signed amounts, debits positive.** Every posting is a signed number: a **debit is positive**,
   a **credit is negative**.
2. **Every entry sums to zero** (per currency). If it doesn't balance, it can't be posted.

By convention, a posting's amount is simply the signed change to that account, so the plain text and
the ledger agree with no sign flipping.

## Chart of accounts (the default seed)

| Code | Account | Type | Normal side |
|---|---|---|---|
| 1000 | Cash | asset | debit |
| 1100 | Investments at cost | asset | debit |
| 1200 | Unrealized appreciation/(depreciation) | asset | debit |
| 1300 | Due from LPs | asset | debit |
| 2000 | Accrued expenses | liability | credit |
| 2100 | Due to GP | liability | credit |
| 3000 | Partners' capital — GP | equity | credit |
| 3100 | Partners' capital — LP (unallocated) | equity | credit |
| 3200 | **Undistributed earnings (bridge)** | equity | credit |
| 3100-`<id>` | Partners' capital — `<LP name>` (one per LP) | equity | credit |
| 4000 | Realized gains | income | credit |
| 4100 | Interest and dividend income | income | credit |
| 4200 | Change in unrealized appreciation | income | credit |
| 5000 | Management fee | expense | debit |
| 5100 | Partnership expenses | expense | debit |
| 5200 | Organizational expenses | expense | debit |

Per-LP capital accounts (`3100-<id>`) are created automatically the first time an allocation touches
that LP. In text they read `Equity:Partners-Capital-<Name>:3100-<id>`.

## Why the bridge (3200) exists

Fees, expenses, and income need to be in **two** places: the **income statement** (as expense/income)
*and* each LP's **capital account** (reducing/increasing it). A compound entry does both at once and
parks the offset in **Undistributed earnings (3200)**. The **period close** later zeroes every
income/expense account into 3200, netting it back to zero. So during a period both statements are
correct; at close the temporary accounts flatten and only capital stands.

## Entry types

Each type below shows the debits/credits, the `source` (which drives the capital-account roll-forward
line), and the text you'd author. `Dr` = positive, `Cr` = negative.

### 1. Opening balances (cutover) — `source: opening_balance`
Take over at a date with each LP's capital from their last statement. **Capital in nets against
cash** — the opening credits each LP's capital and debits Cash; the investment purchase is booked
separately (entry 3), which moves that cash into the investment. Roll-forward line: **beginning**.

| Account | Dr / Cr |
|---|---|
| 1000 Cash | Dr total |
| 3100-`<id>` each LP capital | Cr their opening balance |

```text
2021-06-30 * "Opening capital (cutover)"
  source: "opening_balance"
  Assets:Cash:1000                         3000000.00 USD
  Equity:Partners-Capital-John-Smith:3100-aaaa    -1800000.00 USD
  Equity:Partners-Capital-Acme-LLC:3100-bbbb      -1200000.00 USD
```
*After this, book the investment purchase (entry 3) to move cash into the investment, so ending
cash = paid-in − investment cost.*

### 2. Capital call — `source: capital_call`
Cash comes in; each LP's capital increases pro-rata by commitment. Line: **contributions**.

| Account | Dr / Cr |
|---|---|
| 1000 Cash | Dr total |
| 3100-`<id>` each LP capital | Cr their share |

```text
2021-07-01 * "Capital call — Q3"
  source: "capital_call"
  Assets:Cash:1000                         5000000.00 USD
  Equity:Partners-Capital-John-Smith:3100-aaaa   -3000000.00 USD
  Equity:Partners-Capital-Acme-LLC:3100-bbbb     -2000000.00 USD
```

### 3. Investment purchase — `source: manual` (plain two-line)
Buy the SPV's investment. No allocation — just moves cash into the asset. There is no dedicated
action; book it here in text (or via a bank outflow re-categorized to 1100).

| Account | Dr / Cr |
|---|---|
| 1100 Investments at cost | Dr cost |
| 1000 Cash | Cr cost |

```text
2021-07-15 * "Investment — purchase"
  Assets:Investments-At-Cost:1100          4800000.00 USD
  Assets:Cash:1000                        -4800000.00 USD
```

### 4. Management fee — `source: management_fee` (compound, via bridge)
Expense hits the income statement; each LP's capital is reduced. Line: **managementFees**.

| Account | Dr / Cr |
|---|---|
| 5000 Management fee (expense) | Dr total |
| 2100 Due to GP (liability) | Cr total |
| 3100-`<id>` each LP capital | Dr their fee |
| 3200 Undistributed earnings | Cr total |

```text
2021-09-30 * "Management fee — Q3"
  source: "management_fee"
  Expenses:Management-Fee:5000             50000.00 USD
  Liabilities:Due-To-Gp:2100             -50000.00 USD
  Equity:Partners-Capital-John-Smith:3100-aaaa   30000.00 USD
  Equity:Partners-Capital-Acme-LLC:3100-bbbb     20000.00 USD
  Equity:Undistributed-Earnings:3200    -50000.00 USD
```
Paying the fee later is a separate plain entry: `Dr 2100 Due to GP / Cr 1000 Cash`.

### 5. Partnership expense — `source: partnership_expense` (compound, via bridge)
Same shape as the fee, but paid from cash and allocated pro-rata. Line: **expenses**.

| Account | Dr / Cr |
|---|---|
| 5100 Partnership expenses | Dr total |
| 1000 Cash | Cr total |
| 3100-`<id>` each LP capital | Dr their share |
| 3200 Undistributed earnings | Cr total |

```text
2021-10-05 * "Audit fee"
  source: "partnership_expense"
  Expenses:Partnership-Expenses:5100      12000.00 USD
  Assets:Cash:1000                       -12000.00 USD
  Equity:Partners-Capital-John-Smith:3100-aaaa    7200.00 USD
  Equity:Partners-Capital-Acme-LLC:3100-bbbb      4800.00 USD
  Equity:Undistributed-Earnings:3200     -12000.00 USD
```

### 6. Realized gain / income — `source: realized_gain` (compound, via bridge)
Cash/income in; each LP's capital increases. Line: **gains**.

| Account | Dr / Cr |
|---|---|
| 1000 Cash | Dr total |
| 4000 Realized gains (income) | Cr total |
| 3200 Undistributed earnings | Dr total |
| 3100-`<id>` each LP capital | Cr their share |

```text
2023-03-01 * "Partial realization"
  source: "realized_gain"
  Assets:Cash:1000                         500000.00 USD
  Income:Realized-Gains:4000              -500000.00 USD
  Equity:Undistributed-Earnings:3200       500000.00 USD
  Equity:Partners-Capital-John-Smith:3100-aaaa   -300000.00 USD
  Equity:Partners-Capital-Acme-LLC:3100-bbbb     -200000.00 USD
```

### 7. Revaluation (unrealized mark) — `source: valuation` (compound, via bridge)
Mark the investment to a new fair value. You enter the **new fair value**; the system books the
**delta** vs the current carrying value. Line: **gains**. (A mark-down flips every sign.)

| Account | Dr / Cr |
|---|---|
| 1200 Unrealized appreciation (asset) | Dr delta |
| 4200 Change in unrealized (income) | Cr delta |
| 3200 Undistributed earnings | Dr delta |
| 3100-`<id>` each LP capital | Cr their share |

```text
2022-12-31 * "Year-end mark"
  source: "valuation"
  Assets:Unrealized-Appreciation:1200      1000000.00 USD
  Income:Change-In-Unrealized-Appreciation:4200  -1000000.00 USD
  Equity:Undistributed-Earnings:3200       1000000.00 USD
  Equity:Partners-Capital-John-Smith:3100-aaaa   -600000.00 USD
  Equity:Partners-Capital-Acme-LLC:3100-bbbb     -400000.00 USD
```

### 8. Distribution — `source: distribution`
Cash out to LPs; each LP's capital decreases. Line: **distributions**.

| Account | Dr / Cr |
|---|---|
| 3100-`<id>` each LP capital | Dr their distribution |
| 1000 Cash | Cr total |

```text
2023-03-15 * "Distribution"
  source: "distribution"
  Equity:Partners-Capital-John-Smith:3100-aaaa    300000.00 USD
  Equity:Partners-Capital-Acme-LLC:3100-bbbb      200000.00 USD
  Assets:Cash:1000                        -500000.00 USD
```

### 9. Carried interest — `source: carried_interest`
Move profit from LPs to the GP. Line: **other** (on the LP roll-forward).

| Account | Dr / Cr |
|---|---|
| 3100-`<id>` each LP capital | Dr their carry |
| 3000 Partners' capital — GP | Cr total |

```text
2023-03-15 * "Carried interest"
  source: "carried_interest"
  Equity:Partners-Capital-John-Smith:3100-aaaa    60000.00 USD
  Equity:Partners-Capital-Acme-LLC:3100-bbbb      40000.00 USD
  Equity:Partners-Capital-Gp:3000        -100000.00 USD
```

### 10. Period close — `source: period_close`
Zero every income/expense account into the bridge. No LP postings — capital is already current.

| Account | Dr / Cr |
|---|---|
| each income/expense account | the negation of its balance |
| 3200 Undistributed earnings | the net |

```text
2022-12-31 * "Period close"
  source: "period_close"
  Income:Realized-Gains:4000               500000.00 USD   ; was a -500000 credit balance
  Expenses:Management-Fee:5000            -200000.00 USD   ; was a +200000 debit balance
  Equity:Undistributed-Earnings:3200     -300000.00 USD
```

### 11. Conversion (SAFE / note → equity) — `source: investment` (drafted from the tracker)
A SAFE or convertible note converting into a priced round (e.g. Series A). In the tracker it is
recorded as the **priced-round investment it becomes**, linked to the instrument it converted from
(`converts_from_txn_id`); there is no separate transaction type. Saving it **drafts** the entry
below — like every tracker→ledger mirror, it lands as a draft for review, not a post.

The source instrument's **principal is already in `1100`** from its own purchase date and is never
re-posted. The conversion books only what changes **on the conversion date**, as one entry with up
to three independently-balanced pieces:

| Account | Dr / Cr | When present |
|---|---|---|
| 1100-`<co>` Investments at cost | Dr interest + new cash | interest and/or a follow-on check |
| 1150-`<co>` Accrued interest | Cr interest | a note with accrued interest |
| 1000 Cash | Cr new cash | you wrote a new check into the round |
| 1200-`<co>` Unrealized appreciation | Dr step-up | round price ≠ carried basis |
| 4200 Change in unrealized (income) | Cr step-up | — |

where **carried basis** = source principal + converted interest + new cash, and **step-up** =
(shares × round price) − carried basis (negative on a down round → an unrealized loss). With no
round price the position is held at carried cost and no step-up is booked.

```text
2022-06-01 * "Conversion to equity — Acme (Series A)"   ; $100k SAFE → 50,000 @ $3.00 = $150k
  source: "investment"
  Assets:Unrealized-Appreciation:1200-acme        50000.00 USD   ; the +$50k step-up
  Income:Change-In-Unrealized-Appreciation:4200  -50000.00 USD
  ; a pure conversion moves no cash and does not touch 1100 — the principal is already there
```

**How it reaches the statements** (all derived from the posted ledger):
- **Balance sheet** — the position's carrying value (`1100 + 1200`) becomes shares × round price;
  `1150` accrued interest clears into basis; cash falls by any new check.
- **Statement of operations** — the step-up is **change in unrealized appreciation (`4200`)**, in the
  period of the conversion date, not the SAFE's original date. Interest that accrued *before*
  conversion already hit `4100` over prior closes, so it is not re-recognized here.
- **Cash flows** — a pure conversion moves no cash, so it appears under **supplemental non-cash
  investing & financing** (ASC 230), never as an outflow; a follow-on check shows as an operating
  outflow on the conversion date.
- **Schedule of investments** — cost = carried basis, fair value = shares × round price, and the
  ledger ties to the tracker because the step-up actually posted to `1200`.
- **Changes in partners' capital** — the step-up allocates to LPs (line **gains**) at the next
  **period close**; until then it sits in unallocated earnings.

---

# The capital-account roll-forward

Each LP's statement is built from the postings to their capital account, bucketed by the entry's
`source`:

```
  ending = beginning
         + contributions        (capital_call)
         - distributions        (distribution)
         - management fees       (management_fee)
         - partnership expenses  (partnership_expense)
         + gains                 (realized_gain, valuation)
         + other                 (carried_interest, anything else)
```

`ending` is computed as the **raw sum of that LP's capital postings**, so it always ties to the
ledger regardless of how lines are labeled. **Fund NAV = sum of every LP's ending capital.**

---

# Verifying the books

Checks that should always hold — use these to confirm a new setup and to sanity-check a close:

- **Every entry balances.** The Journal and Plain text pages reject unbalanced entries; the trial
  balance (Financial statements) shows equal total debits and credits.
- **Balance sheet identity.** Assets = Liabilities + Partners' capital. On the Financial statements
  page the balance-sheet `check` is 0 once the period is closed (before close, the residual equals
  net income not yet closed to capital).
- **NAV ties.** Fund NAV on the Capital accounts page = sum of the LPs' ending capital = the equity
  total on the balance sheet.
- **Bridge nets to zero after close.** Account 3200 Undistributed earnings should be 0 once you've
  run the period close; income/expense accounts should be 0 too.
- **Reconcile against the LP snapshot.** On Reconciliation → *Load from LP snapshot*, contributions
  should match paid-in and distributions should match the LP data already in the platform.
- **Bank reconciliation.** Ledger cash (1000) equals the bank feed's ending balance once every
  transaction is matched.
- **Per-vehicle isolation.** Each `portfolio_group` has its own chart, entries, and capital accounts;
  switching the vehicle selector should change every figure.

---

# Authoring in text — quick rules

- A transaction is `DATE FLAG "narration"` then indented postings. `*` posts; `!` saves a draft.
- Reference accounts by full name (`Assets:Cash:1000`) or just the code is matched from the last
  component. Unknown accounts are reported, never guessed.
- One posting per entry may **omit its amount** — it's inferred so the entry balances.
- `source: "<type>"` metadata sets the roll-forward line; omit it for a plain `manual` entry.
- Lines starting with `;` are comments; `open`/`close`/other directives are ignored.

---

# Agents

Everything above is also available to agents over MCP/REST (Settings → *Agent access*): seed the
chart, import a bank feed, categorize, book calls, revalue, author entries as text, reconcile, and
close periods — each scoped to a vehicle via the `vehicle` argument.
