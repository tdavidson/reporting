# Fund accounting — double-entry reference

How every entry type is booked, in both T-account form and the plain-text (beancount) syntax you
author in. Use this to write entries on the **Ledger text** page and to verify the books are set up
correctly. Everything here matches what the entry builders in `lib/accounting/entries.ts` produce.

## The two rules that make it all work

1. **Signed amounts, debits positive.** Every posting is a signed number: a **debit is positive**,
   a **credit is negative**.
2. **Every entry sums to zero** (per currency). If it doesn't balance, it can't be posted.

This is exactly beancount's own convention, so the plain text and the ledger agree with no sign
flipping: a posting amount is simply the signed change to that account.

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

---

# Entry types

Each type below shows the debits/credits, the `source` (which drives the capital-account roll-forward
line), and the text you'd author. `Dr` = positive, `Cr` = negative.

### 1. Opening balances (cutover) — `source: opening_balance`
Take over at a date with each LP's capital from their last statement. Roll-forward line: **beginning**.

| Account | Dr / Cr |
|---|---|
| 1100 Investments at cost | Dr total |
| 3100-`<id>` each LP capital | Cr their opening balance |

```beancount
2021-06-30 * "Opening balances (cutover)"
  source: "opening_balance"
  Assets:Investments-At-Cost:1100          3000000.00 USD
  Equity:Partners-Capital-John-Smith:3100-aaaa    -1800000.00 USD
  Equity:Partners-Capital-Acme-LLC:3100-bbbb      -1200000.00 USD
```
*(1100 is a placeholder for net assets at cutover; reclassify to real cash/investment as history is added.)*

### 2. Capital call — `source: capital_call`
Cash comes in; each LP's capital increases pro-rata by commitment. Line: **contributions**.

| Account | Dr / Cr |
|---|---|
| 1000 Cash | Dr total |
| 3100-`<id>` each LP capital | Cr their share |

```beancount
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

```beancount
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

```beancount
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

```beancount
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

```beancount
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

```beancount
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

```beancount
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

```beancount
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

```beancount
2022-12-31 * "Period close"
  source: "period_close"
  Income:Realized-Gains:4000               500000.00 USD   ; was a -500000 credit balance
  Expenses:Management-Fee:5000            -200000.00 USD   ; was a +200000 debit balance
  Equity:Undistributed-Earnings:3200     -300000.00 USD
```

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

# Verifying the system is set up correctly

Checks that should always hold — use these to confirm the books:

- **Every entry balances.** The Journal and Ledger text pages reject unbalanced entries; the trial
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
