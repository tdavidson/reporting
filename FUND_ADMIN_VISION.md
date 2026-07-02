# Fund Admin Vision — the next part of the roadmap

*Status: proposal / thinking doc. Not yet built. Author: Taylor Davidson.*

## TL;DR

The platform today is a strong **front office** — IR, reporting, deal, and diligence tooling.
The missing half is the **back office / finance function**: there is no *book of record*.
The single highest-leverage next step — for getting real usage **and** for positioning
Taylor as a fractional CFO — is to build the **fund-accounting spine**: a plain-text,
double-entry ledger, with a **capital-account / allocation engine** as the first wedge.

Everything the platform already reports (NAV, capital accounts, DPI/TVPI/IRR) should be
**derived from** that ledger instead of typed in.

---

## Where we are: a front office without a back office

**Built and substantial (front office / IR):**

- AI email → KPI extraction pipeline and portfolio dashboards
- Inbound deal screening, AI diligence + investment-memo agent
- LP report cards / capital-account statements, quarterly LP letters
- A full LP portal with a per-LP AI analyst and document delivery
- A compliance calendar/registry and a lightweight CRM

**Missing (back office / finance function):**

- **No book of record.** NAV, capital accounts, paid-in, distributions, DPI/RVPI/TVPI/IRR
  are *presented* from `fund_cash_flows` plus manually-maintained figures in `lp_investments`
  (`lib/lp-overview.ts`, `lib/lp-report-pdf.ts`). Nothing books an entry.
- No general ledger, chart of accounts, or journal entries.
- No allocation engine (calls / distributions / fees / expenses / income / gains → per-LP).
- No management-fee, carried-interest, or expense-allocation engine.

That gap is, almost exactly, the fractional-CFO job description. So "what's the missing half
of the product?" and "what work leads to fractional CFO engagements?" have the same answer.

---

## The four options, scored against the two goals

Goals: **(1) get actual usage**, and **(2) showcase CFO capability → fractional CFO work.**

| Option | Gets real usage? | Showcases CFO skill? | Verdict |
|---|---|---|---|
| Extend the LP experience | Low — already the most-built area; marginal returns | No — IR/comms, not finance | Defer |
| Bring Hemrock fund modeling into the admin | Medium — "model vs. actuals" is nice but heavy; it's an *analyst* skill | Partial — modeling ≠ running the books | Later differentiator |
| Fund closing (LPA / e-sign / wiring / KYC-AML) | Low as OSS — regulated, trust-heavy, episodic, entrenched competitors | Partial — more COO/counsel than CFO | Not the wedge |
| **Fund accounting (plain-text ledger)** | **High** — the spine everything needs; reconciliation is *weekly*, so recurring usage | **Yes — the CFO's home turf** | **Do this** |

---

## Recommendation: the plain-text fund-accounting spine

### Why it wins on both axes

1. **It makes everything else true.** A double-entry ledger under the existing capital-account
   statement turns "numbers someone typed in" into "figures traceable to entries." That's the
   line between a *reporting tool* and a *system of record* — and the system of record is what
   funds pay a fund admin (or a CFO) for.

2. **Plain-text accounting is the genuine AI-native differentiator.** A text-backed, double-entry
   ledger (beancount/hledger applied to a fund) is:
   - **Diffable and git-versioned** — every change to the books is a reviewable commit.
   - **LLM-readable and writable** — an agent can *draft* journal entries from a capital-call
     notice or a bank statement, propose reconciliations, and explain any balance in English.
     Mainstream fund admins (Carta, Juniper Square, Standish) can't, because their books live in
     opaque relational schemas.
   - **Reconciliation is the product** — "here's the bank feed, here's the ledger, here are the
     three entries I propose to true it up." That's a CFO's Monday morning, automated.

3. **It converts usage into engagements.** Build the spine → keep the books for 1–2 real
   emerging-manager funds on it → those become case studies + recurring revenue that *is*
   fractional-CFO work → publish the plain-text-fund-accounting method as content → managers who
   read it and need books-done hire Taylor. The OSS tool is simultaneously lead-gen, proof of
   competence, and leverage (one CFO services many more funds when the agent drafts entries).

### What "AI-native fund admin" actually means

Not a chatbot bolted onto a fund admin. It means **the book of record is a medium the AI can
operate on directly**:

- **Documents in, entries out** — a capital-call notice, wire confirmation, invoice, or
  distribution notice arrives by email (the inbound pipeline already exists) → the agent proposes
  journal entries → a human approves → the ledger updates → capital accounts and NAV recompute.
- **Reconciliation as a conversation** — "why is Fund II cash off by $12k?" gets a traced answer.
- **Every LP number is explainable** — the existing LP analyst can walk a capital account back to
  source entries.
- **Auditable by construction** — text + git history + double-entry invariants enforced on commit.

---

## Architecture decision: where does "plain text" live?

Two viable models:

- **A. Text is the source of truth.** The ledger literally lives as beancount/hledger-style text
  files; Postgres is an index/cache derived from them. Maximally git-native and auditable.
- **B. Postgres is the source of truth; text is a view.** Double-entry lives in tables; text is a
  human/LLM-readable serialization you can export, diff, and re-import.

**Recommendation: B, evolving toward A's benefits.** This repo is multi-tenant Supabase with RLS,
concurrent writers, and fund-scoped access resolved in application code (see `CLAUDE.md`). Putting
the authoritative books in flat files fights all of that (concurrency, per-fund isolation, RLS).
Keep the authoritative double-entry in Postgres, and get the plain-text payoff by generating a
**canonical text serialization per fund per period** that is:

- committed to a per-fund git-backed store (or the fund's document storage) on every close,
- the exact surface the AI reads/drafts against, and
- round-trippable (text → proposed entries → approved rows).

You get git-diffable, LLM-native books without giving up tenancy, concurrency, and RLS. If a
single-fund self-hosted deployment wants pure model A later, the serializer already defines the
format.

> Open question for Taylor: is your "plain text fund accounting" idea specifically model A
> (files are truth), or the payoff of model B? This doc assumes B; easy to flip.

---

## Proposed data model (sketch)

Follows repo conventions in `CLAUDE.md`: every new table carries inline Data-API grants, RLS
enabled, and at least one policy per role. Fund scoping via `fund_members`. Sketch only — not a
migration.

```
chart_of_accounts
  id, fund_id → funds
  code            text        -- e.g. "1000" cash, "3000" LP capital, "4000" mgmt fee income
  name            text
  type            text        -- asset | liability | equity | income | expense
  parent_id       uuid null   -- hierarchy
  lp_entity_id    uuid null   -- set for per-LP capital sub-accounts (→ lp_entities)
  created_at

journal_entries              -- the "transaction" header
  id, fund_id → funds
  entry_date      date
  memo            text
  source_type     text null   -- capital_call | distribution | expense | fee | valuation | manual
  source_ref      text null   -- e.g. inbound_emails.id, lp_documents.id, bank txn id
  status          text        -- draft | posted | void   (draft = AI-proposed, awaiting approval)
  created_by      uuid
  posted_at       timestamptz null
  created_at

journal_postings             -- the double-entry lines; SUM(amount) per entry MUST = 0
  id, fund_id → funds
  journal_entry_id → journal_entries
  account_id      → chart_of_accounts
  amount          numeric      -- signed; debits +, credits - (or store dr/cr explicitly)
  currency        text
  lp_entity_id    uuid null    -- optional per-LP dimension for allocation
  created_at

fiscal_periods
  id, fund_id, period_start, period_end, status (open|closed), closed_at

allocation_runs              -- output of the allocation engine for a period
  id, fund_id, period_id, method, created_at, created_by
allocation_results
  id, fund_id, allocation_run_id, lp_entity_id, account_id, amount
```

Capital accounts and NAV become **queries** over `journal_postings` (balances by account, scoped
by `lp_entity_id`) rather than stored figures — the existing `lp_snapshots` / report-card UI
reads from the derived balances. Invariant to enforce in code and as a check:
`SUM(amount) = 0` per `journal_entry`, per currency.

---

## Sequencing

1. **Ledger core** — `chart_of_accounts`, `journal_entries`, `journal_postings`, `fiscal_periods`;
   `lib/accounting/` with the double-entry invariant enforced. The spine.
2. **Capital-account / allocation engine** — allocate calls, distributions, fees, expenses,
   income, and unrealized gains per LP per period → *derive* the capital-account statement already
   rendered. Plugs into `lp_snapshots` and the report-card UI. **This is the wedge — build 1 + 2 first.**
3. **Management fee + carried interest + expense allocation** — the calcs a CFO is asked about
   most; also where Hemrock waterfall logic eventually plugs in (model → actuals).
4. **AI entry-drafting + reconciliation** — layer the agent on the ledger. Documents-in-entries-out
   and "reconcile this bank feed." This is the demo that sells the fractional-CFO story.
5. **Later** — closing/subscription workflow and Hemrock modeling integration, now that there is a
   book of record to hang them on.

---

## The fractional-CFO funnel (why this is the business move, not just the product move)

1. Build the accounting spine (steps 1–2 above).
2. Keep the books for 1–2 real emerging-manager funds on it → recurring revenue that *is*
   fractional-CFO work, plus reference customers.
3. Turn those into public case studies + a written "plain-text fund accounting" method/spec.
4. That content is the top of the funnel: emerging managers who need books-done find Taylor.
5. The tooling is the leverage — one CFO can service many funds because the agent drafts the
   entries and reconciliations; the human approves and advises.

The open-source platform, the content, and the fractional-CFO practice are the same flywheel.
