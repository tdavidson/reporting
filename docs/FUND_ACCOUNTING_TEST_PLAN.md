# Fund Accounting — first test plan (shadow-reconcile against your own fund)

*Status: test plan / learning scaffold. Pairs with `FUND_ADMIN_VISION.md`.*

## Two goals at once

1. **Validate the wedge** — prove that a parallel double-entry ledger can reproduce a real
   fund's capital accounts and **reconcile to the existing fund admin's statement**, per LP.
   This is the "land an existing fund" adoption path (Rung 2 in the vision doc) at zero risk.
2. **Learn fund accounting deeply.** The reconciliation is a forcing function: if a number is
   wrong, the books won't tie out, so you can't hand-wave past a concept you don't understand.
   Each step below names the concept it teaches.

**First test subject: your own fund** (or one you already do CFO work for). You have the source
docs, the admin statements, *and* you know the right answer. No sales, full data, instant feedback.

---

## The whole test in one sentence

> Take your fund's last capital account statement as **opening balances**, process **one period**
> of activity into double-entry journal entries, allocate it per-LP, produce **ending capital
> accounts**, and lay them **side-by-side against the admin's statement** for that period.

Success = it ties to the penny, or every delta is explainable. That side-by-side diff is both the
test result and, later, the sales artifact.

---

## Fund accounting primer (the concepts you need — learn these as you build)

### 1. Double-entry and the accounting equation
Every transaction touches at least two accounts, and **debits = credits** on every entry
(`SUM(postings) = 0`). The balance sheet identity:

```
Assets = Liabilities + Equity(Partners' Capital)
```

Convention: **assets and expenses increase with debits**; **liabilities, equity, and income
increase with credits**. If you internalize only one rule, internalize that the entry must balance
— it's the guardrail that catches most mistakes.

### 2. A VC fund's chart of accounts (minimal)
- **Assets** — Cash; Investments at cost; Unrealized appreciation/(depreciation)
- **Liabilities** — Accrued expenses; Due to GP
- **Equity (Partners' Capital)** — one capital account **per LP**, plus the GP's capital account
- **Income** — Realized gains; Interest/dividend income
- **Expenses** — Management fee; Partnership expenses (audit, legal, admin); Organizational expenses

### 3. The capital account roll-forward — THE mental model
Fund accounting is, at its core, maintaining each partner's capital account. Per partner, per period:

```
  Beginning capital
+ Contributions        (capital called and paid in this period)
- Distributions        (cash/stock returned to the LP)
+ Allocated income     (realized gains, interest, dividends)
- Allocated expenses    (management fee, partnership expenses)
+/- Allocated unrealized gain/loss   (mark-to-market on the portfolio)
- Carried interest      (profit share reallocated from LPs to GP, if any)
= Ending capital        (this LP's NAV)
```

Sum of every partner's ending capital = **fund NAV**. Everything the report cards already show
(paid-in, distributions, NAV, DPI/RVPI/TVPI, IRR) is derived from this roll-forward.

### 4. Allocation — how a fund-level number becomes per-LP
Most line items are allocated **pro-rata by ownership %** (commitment- or contribution-based,
depending on the item and the LPA). Start every item as simple pro-rata; the complications in the
checklist below are the exceptions that break it.

### 4b. Derived outputs beyond capital accounts
Once the ledger holds per-investment cost and fair value, two more artifacts fall out for free:
- **Schedule of investments (SOI)** — each portfolio investment with cost, fair value, and % of
  net assets. Sourced from `investment_transactions` / `investment_valuations` + investment accounts.
- **Financial statements** — balance sheet, income statement, statement of changes in partners'
  capital, statement of cash flows, and notes — all derived from the trial balance.

These aren't part of the first tie-out, but they're the reason the ledger is worth building: they
become *derived*, not separately maintained.

### 5. The metrics (already in the codebase)
- **Paid-in capital (PIC)** = cumulative contributions
- **DPI** = cumulative distributions ÷ PIC
- **RVPI** = NAV ÷ PIC
- **TVPI** = DPI + RVPI = (distributions + NAV) ÷ PIC
- **IRR / XIRR** = money-weighted return on the dated cash flows (`lib/xirr.ts`)

---

## The test flow, step by step

### Step 0 — Gather inputs (and define the answer key)
- A recent **capital account statement** (per-LP balances) to use as opening balances.
- **One period** of source docs: capital-call notices, distribution notices, the management-fee
  calc, expense invoices, and the period-end valuations (marks).
- The admin's **capital account statement at the END of that period** — this is your answer key.
- *Concept:* what a fund admin actually produces each period, and what feeds it.

### Step 1 — Book opening balances
Enter each partner's beginning capital as a single opening-balance journal entry (do **not**
reconstruct history from inception — you take over at a cutover date, like a real admin conversion).
- *Concept:* opening balances / trial balance; why cutover beats reconstruction.
- *Check:* sum of opening capital = fund NAV on the opening statement.

### Step 2 — Process the period into journal entries
For each event, write the balanced entry, then allocate per-LP:
- **Capital call** — Dr Cash / Cr each LP's capital (contribution) — pro-rata by commitment.
- **Management fee** — Dr Management fee expense / Cr Cash (or Due to GP); allocate the expense
  across LP capital accounts.
- **Partnership expense** — Dr Expense / Cr Cash; allocate across LP capital.
- **Distribution** — Dr each LP's capital / Cr Cash — per the distribution notice.
- **Valuation change** — Dr/Cr Unrealized appreciation vs. capital; allocate the mark per-LP.
- *Concept:* how each real-world event becomes double-entry, and where it lands in the roll-forward.

### Step 3 — Produce ending capital accounts
Roll each partner forward (Step 1 balance + Step 2 activity). Ending capital per LP; sum = NAV.
- *Concept:* the roll-forward as a query over postings, not a stored number.

### Step 4 — Reconcile (the deliverable)
Two reconciles, in order:
- **Internal** — where a ledger-sourced copy of an existing page (e.g. a report card) is compared
  against the current page. Proves the new source reproduces what the app already shows.
- **External** — side-by-side, **per LP**, your ending capital vs the admin's, with a **per-line
  delta** (contributions, distributions, fees, gains) to localize any discrepancy. Proves the
  numbers are actually right.
- *Concept:* reconciliation — the core fund-admin discipline. See "Build strategy" in
  `FUND_ADMIN_VISION.md` for how this scales page-by-page (shadow → internal reconcile → cut over).

---

## Success criteria

- **Tie-out:** each LP's ending capital matches the admin's, within a defined tolerance
  (start at exact; allow sub-dollar rounding once you understand the rounding convention).
- **Explainable deltas:** every non-zero delta is traced to a specific line and either fixed or
  attributed to a complication you haven't built yet.
- **The best possible outcome:** a delta where **you're right and the admin is wrong.** Fund admins
  make errors; catching one is the strongest adoption/credibility event there is. Log these loudly.

---

## The complications checklist — this IS your roadmap

Your first pass will use pure pro-rata and will **not** tie out. Each miss points to one of these.
Build only the ones your real fund actually has, in the order they break the tie-out. Each line is
also a fund-accounting concept to learn:

- [ ] **Side letters / fee discounts** — some LPs pay reduced or zero management fee.
- [ ] **GP & employee vehicles** — typically pay no management fee and bear no carry.
- [ ] **Management fee basis** — on committed capital during the investment period, then on
      invested/NAV after; plus step-downs.
- [ ] **Management fee offsets** — director/transaction fees that reduce the management fee.
- [ ] **Mid-period / subsequent closes** — new LPs equalize (true-up + equalization interest) so
      all LPs end as if admitted at first close.
- [ ] **Excused / excluded investors** — an LP excused from a deal doesn't share its gain/loss.
- [ ] **Realized vs unrealized** — gains through income vs marks straight to capital.
- [ ] **Carried interest / waterfall** — GP profit share; European (whole-fund) vs American
      (deal-by-deal); hurdle and catch-up. (Where Hemrock's waterfall logic eventually plugs in.)
- [ ] **Recycling / recallable distributions** — distributions that increase callable capital.
- [ ] **Multiple share classes / feeders / blockers** — parallel structures with different terms.

---

## What to build to run the test (minimum — narrower than the full vision)

You do **not** need the git serialization, AI entry-drafting, or new portal work for this test.
You need three things, mostly building on what exists:

1. **Opening-balance import** — capital account statement → per-LP starting balances.
   Builds on `lib/demo`/import tooling, `lp_investments`, `fund_cash_flows`.
2. **Allocation engine** — period activity → per-LP allocations. Start pro-rata by commitment;
   add complications from the checklist as the fund requires. New `lib/accounting/`.
3. **Reconciliation view** — per-LP, per-line side-by-side diff vs the admin statement. The deliverable.

The platform already computes capital accounts for the report cards (`lib/lp-overview.ts`,
`lib/lp-report-pdf.ts`), so the real new work is the allocation correctness + the reconciliation
harness — not the whole ledger, yet.

---

## After tie-out

1. Your fund ties out → that's the case study and the demo.
2. Run the same shadow-reconcile for **one friendly external fund** → your first landing.
3. Pitch: *"I independently rebuilt your capital accounts, they tie out to your admin, and the LP
   portal comes with it."* → converts into a fractional-CFO engagement.
4. The complications you had to build become the product's real feature set — discovered from live
   funds, not guessed.
