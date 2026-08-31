// Portfolio construction — how much investable capital is left, how many more deals fit, and
// what exit the portfolio needs to return the target multiple.
//
// PURE. No I/O, no Supabase, and no clock except the `today` a caller passes in. That is
// deliberate and load-bearing: the SAME function runs on the server (to seed the page) and in
// the browser (on every keystroke), so a GP twiddling a check size gets an instant answer
// instead of a round trip. It also means the arithmetic is pinned by unit tests rather than by
// a screenshot.
//
// WHAT IS DERIVED vs WHAT IS STATED. `ConstructionActuals` is what the system knows — committed
// capital from the commitment events, fees and expenses INCURRED from the ledger, capital
// deployed from the portfolio tracker. `ConstructionAssumptions` is what the GP states about the
// future. The two never mix: nothing a user types can move a derived number.
//
// NOT the ledger forecast (plans/plan-forecast.md). That compiles hypotheticals into journal
// postings so the statements forecast themselves. Construction never touches a journal — nobody
// is asking for a forecast balance sheet here — so it is deliberately built apart from it.

import type { FeeBasis } from './fees'

const r = (n: number) => Math.round(n * 100) / 100

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000

/**
 * One band of the FORWARD-LOOKING portfolio.
 *
 * Actuals are not stage-classified: `investment_transactions.round_name` is free text
 * ("Seed", "Pre-Seed Extension", "SAFE") and normalising it is a guess that would silently
 * mis-weight the whole return model. So a stage describes deals not yet done.
 */
export interface ConstructionStage {
  key: string
  label: string
  /** How many NEW deals to do in this band. */
  deals: number
  initialCheck: number
  initialPostMoney: number
  /** Follow-on dollars per initial dollar. 1 = reserve a second check the size of the first. */
  followOnMultiple: number
  /** Fraction of initial ownership surviving to exit. 0.3 = diluted to 30% of entry ownership. */
  dilutionFactor: number
}

export interface ConstructionAssumptions {
  feeAnnualRate: number
  feeBasis: FeeBasis
  feeTermYears: number
  /** ISO date. The fee clock's start. Empty means no clock, and no fees are projected. */
  feeStartDate: string
  feeStepDownYear: number | null
  feeStepDownRate: number | null
  annualPartnershipExpense: number
  remainingOrgCosts: number
  targetPortfolioSize: number
  existingReservePool: number
  targetFundMultiple: number
  sensitivityOwnerships: number[]
  stages: ConstructionStage[]
}

export interface ConstructionActuals {
  /** From the commitment events or lp_positions — does NOT require fund accounting. */
  committedCapital: number
  /**
   * Ledger-only, all three. On an LP-tracking vehicle they come back as 0, which would overstate
   * investable capital — so `ledgerAvailable` says so, and the model warns rather than implying
   * the fund has spent nothing.
   */
  managementFeesIncurred: number
  orgCostsIncurred: number
  partnershipExpensesIncurred: number
  ledgerAvailable: boolean
  /** From the portfolio tracker, split by lib/accounting/soi.ts. */
  deployedInitial: number
  deployedFollowOn: number
  companyCount: number
  currentValue: number
  nav: number
}

export const DEFAULT_STAGES: ConstructionStage[] = [
  { key: 'pre_seed', label: 'Pre-seed', deals: 5, initialCheck: 500_000, initialPostMoney: 7_000_000, followOnMultiple: 1, dilutionFactor: 0.3 },
  { key: 'seed', label: 'Seed', deals: 10, initialCheck: 500_000, initialPostMoney: 11_000_000, followOnMultiple: 1, dilutionFactor: 0.3 },
  { key: 'post_seed', label: 'Post-seed', deals: 5, initialCheck: 250_000, initialPostMoney: 20_000_000, followOnMultiple: 1, dilutionFactor: 0.4 },
]

export const DEFAULT_ASSUMPTIONS: ConstructionAssumptions = {
  feeAnnualRate: 0.02,
  feeBasis: 'committed',
  feeTermYears: 10,
  feeStartDate: '',
  feeStepDownYear: null,
  feeStepDownRate: null,
  annualPartnershipExpense: 0,
  remainingOrgCosts: 0,
  targetPortfolioSize: 20,
  existingReservePool: 0,
  targetFundMultiple: 3,
  sensitivityOwnerships: [0.01, 0.02, 0.03],
  stages: DEFAULT_STAGES,
}

const FEE_BASES: FeeBasis[] = ['committed', 'invested', 'nav']

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

const nullableNum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/**
 * Read a stored row (or nothing) into a complete, valid assumptions object.
 *
 * There is no zod in this repo, so this is THE validation boundary: everything reaching
 * `constructionModel` has been through here, which is why the model itself does no defensive
 * checking. A malformed stage is DROPPED rather than coerced — a stage with a zero
 * `initialPostMoney` would divide to Infinity and quietly report an infinite ownership.
 */
export function parseAssumptions(raw: unknown, vintageYear: number | null): ConstructionAssumptions {
  const o = (raw ?? {}) as Record<string, unknown>
  const basis = FEE_BASES.includes(o.feeBasis as FeeBasis) ? (o.feeBasis as FeeBasis) : 'committed'

  const rawStages = Array.isArray(o.stages) ? o.stages : null
  const stages: ConstructionStage[] = rawStages
    ? rawStages
        .map(s => s as Record<string, unknown>)
        .filter(s =>
          typeof s?.key === 'string' &&
          typeof s?.label === 'string' &&
          Number.isFinite(s?.deals) &&
          Number.isFinite(s?.initialCheck) &&
          Number.isFinite(s?.initialPostMoney) && (s.initialPostMoney as number) > 0 &&
          Number.isFinite(s?.followOnMultiple) &&
          Number.isFinite(s?.dilutionFactor))
        .map(s => ({
          key: s.key as string,
          label: s.label as string,
          deals: s.deals as number,
          initialCheck: s.initialCheck as number,
          initialPostMoney: s.initialPostMoney as number,
          followOnMultiple: s.followOnMultiple as number,
          dilutionFactor: s.dilutionFactor as number,
        }))
    : DEFAULT_STAGES

  const sens = Array.isArray(o.sensitivityOwnerships)
    ? (o.sensitivityOwnerships as unknown[]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
    : []

  return {
    feeAnnualRate: num(o.feeAnnualRate, DEFAULT_ASSUMPTIONS.feeAnnualRate),
    feeBasis: basis,
    feeTermYears: num(o.feeTermYears, DEFAULT_ASSUMPTIONS.feeTermYears),
    // The fee clock defaults to 1 January of the vintage year — the closest thing the schema has
    // to a fund start date. Empty when there is no vintage either: the model then projects no
    // remaining fees, and the GP is asked for the date rather than shown a number derived from
    // a fiction.
    feeStartDate: typeof o.feeStartDate === 'string' && o.feeStartDate
      ? o.feeStartDate
      : vintageYear ? `${vintageYear}-01-01` : '',
    feeStepDownYear: nullableNum(o.feeStepDownYear),
    feeStepDownRate: nullableNum(o.feeStepDownRate),
    annualPartnershipExpense: num(o.annualPartnershipExpense, 0),
    remainingOrgCosts: num(o.remainingOrgCosts, 0),
    targetPortfolioSize: num(o.targetPortfolioSize, DEFAULT_ASSUMPTIONS.targetPortfolioSize),
    existingReservePool: num(o.existingReservePool, 0),
    targetFundMultiple: num(o.targetFundMultiple, DEFAULT_ASSUMPTIONS.targetFundMultiple),
    sensitivityOwnerships: sens.length > 0 ? sens : DEFAULT_ASSUMPTIONS.sensitivityOwnerships,
    stages,
  }
}

/** Years (fractional) between two dates. */
function yearsBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_YEAR
}

/** Fund years elapsed since the fee clock started. 0 when there is no clock. */
function yearsElapsed(a: ConstructionAssumptions, today: Date): number {
  if (!a.feeStartDate) return 0
  const start = new Date(a.feeStartDate)
  if (Number.isNaN(start.getTime())) return 0
  return Math.max(0, yearsBetween(start, today))
}

/**
 * Management fees NOT YET INCURRED, over the remainder of the fee term.
 *
 * Reuses lib/accounting/fees.ts's semantics — fee = basis × rate × periodFraction — but at the
 * FUND level rather than per LP. This is a planning number over a ten-year horizon, and per-LP
 * side letters and exemptions net out well inside its error bars; modelling them here would add
 * a second, drifting copy of the fee engine for no gain in the answer.
 *
 * Each remaining year is charged at its OWN rate, so a step-down lands on the right years rather
 * than being averaged across the whole remaining term.
 *
 * Returns 0 when the term has run out or the fee clock has no start date.
 */
export function projectRemainingFees(
  a: ConstructionAssumptions,
  committedCapital: number,
  deployedTotal: number,
  nav: number,
  today: Date,
): number {
  if (!a.feeStartDate) return 0

  const elapsed = yearsElapsed(a, today)
  if (a.feeTermYears - elapsed <= 0) return 0

  const basisAmount =
    a.feeBasis === 'invested' ? deployedTotal :
    a.feeBasis === 'nav' ? nav :
    committedCapital

  // Walk the remaining term year by year. `yr` is the fund year (1-based) the slice sits in; a
  // partial first or last slice charges pro-rata.
  let fees = 0
  let cursor = elapsed
  while (cursor < a.feeTermYears) {
    const yr = Math.floor(cursor) + 1
    const sliceEnd = Math.min(Math.floor(cursor) + 1, a.feeTermYears)
    const rate = a.feeStepDownYear != null && a.feeStepDownRate != null && yr >= a.feeStepDownYear
      ? a.feeStepDownRate
      : a.feeAnnualRate
    fees += basisAmount * rate * (sliceEnd - cursor)
    cursor = sliceEnd
  }
  return r(fees)
}

export interface CapitalBlock {
  committedCapital: number
  feesIncurred: number
  feesProjected: number
  lifetimeFees: number
  orgCostsIncurred: number
  expensesIncurred: number
  expensesProjected: number
  lifetimeExpenses: number
  investable: number
  /** Whether the incurred figures came from a ledger at all. */
  ledgerAvailable: boolean

  deployedInitial: number
  deployedFollowOn: number
  deployedTotal: number
  existingReservePool: number
  remaining: number

  companyCount: number
  plannedNewDeals: number
  /** What the stage mix would cost: Σ deals × check × (1 + followOnMultiple). */
  plannedCost: number
  /** remaining − plannedCost. Negative means the mix does not fit. */
  gap: number
  /** remaining ÷ plannedNewDeals. Null when there are no deals left to do. */
  avgPerRemainingDeal: number | null
}

export interface StageReturn extends ConstructionStage {
  /** initialCheck / initialPostMoney. */
  initialOwnership: number
  /** initialOwnership × dilutionFactor. */
  ownershipAtExit: number
  /** The exit valuation at which this stage's ownership alone returns the whole fund. */
  exitToReturnFund: number
  /** deals × check × (1 + followOnMultiple) — what this band consumes. */
  allocation: number
}

export interface SensitivityRow {
  ownershipAtExit: number
  avgExitForTargetReturn: number
  exitToReturnFund: number
  /** The row derived from the stage mix rather than stated. */
  isWeightedAverage: boolean
}

export interface ReturnsBlock {
  targetFundMultiple: number
  requiredPortfolioValue: number
  /**
   * The same required value expressed against INVESTABLE capital rather than committed. A "5x
   * fund" is 5× committed, but only ~76% of committed is ever invested — so the portfolio has to
   * clear the larger number, and that is the one worth stating out loud.
   */
  impliedMultipleOnInvested: number | null
  stages: StageReturn[]
  /** Deal-count-weighted. Null when the mix has no deals — never Infinity. */
  wAvgOwnershipAtExit: number | null
  avgExitForTargetReturn: number | null
  exitToReturnFund: number | null
  sensitivity: SensitivityRow[]
}

export interface ConstructionResult {
  capital: CapitalBlock
  returns: ReturnsBlock
  warnings: string[]
}

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

/**
 * The whole model. `today` is a parameter so a test can pin a date.
 *
 * The warnings are the point of the page, not decoration: a stage mix that costs more than
 * remains, or whose deal counts do not add up to the deals still to do, is a plan that will not
 * happen. The spreadsheet this replaces could not tell its author either of those things.
 */
export function constructionModel(
  actuals: ConstructionActuals,
  a: ConstructionAssumptions,
  today: Date = new Date(),
): ConstructionResult {
  const warnings: string[] = []

  // ── Investable capital ──────────────────────────────────────────────────────
  const deployedTotal = r(actuals.deployedInitial + actuals.deployedFollowOn)

  const feesProjected = projectRemainingFees(a, actuals.committedCapital, deployedTotal, actuals.nav, today)
  const lifetimeFees = r(actuals.managementFeesIncurred + feesProjected)

  // Remaining years of expense run-rate, bounded at 0 — a fund past its term accrues no more.
  const remainingYears = Math.max(0, a.feeTermYears - yearsElapsed(a, today))
  const expensesProjected = r(a.annualPartnershipExpense * remainingYears + a.remainingOrgCosts)
  const lifetimeExpenses = r(actuals.orgCostsIncurred + actuals.partnershipExpensesIncurred + expensesProjected)

  const investable = r(actuals.committedCapital - lifetimeFees - lifetimeExpenses)
  const remaining = r(investable - deployedTotal - a.existingReservePool)

  const plannedNewDeals = a.targetPortfolioSize - actuals.companyCount
  const plannedCost = r(a.stages.reduce((s, st) => s + st.deals * st.initialCheck * (1 + st.followOnMultiple), 0))
  const gap = r(remaining - plannedCost)
  const stageDeals = a.stages.reduce((s, st) => s + st.deals, 0)

  if (!actuals.ledgerAvailable) {
    warnings.push(
      'Fees and expenses are not on the ledger for this vehicle, so only what you enter is counted. ' +
      'Investable capital is overstated until you enter lifetime figures.',
    )
  }
  if (gap < 0) {
    warnings.push(`The stage mix needs more capital than remains — it is short by ${usd(Math.abs(gap))}.`)
  }
  if (stageDeals !== plannedNewDeals) {
    warnings.push(`The stage mix plans ${stageDeals} deals, but ${plannedNewDeals} remain to reach a portfolio of ${a.targetPortfolioSize}.`)
  }

  // ── The return model ────────────────────────────────────────────────────────
  //
  // KNOWN SIMPLIFICATION: follow-on dollars buy pro-rata that reduces dilution, but
  // `dilutionFactor` does not react to `followOnMultiple`. Keeping them independent means the
  // dilution assumption stays something the GP STATES rather than something the model infers
  // from a reserve number. Revisit only if the two are observed to drift in practice.
  const stageReturns: StageReturn[] = a.stages.map(st => {
    // parseAssumptions has already dropped any stage with a non-positive post-money, so this
    // cannot divide by zero — the guard is belt-and-braces for a hand-built literal in a test.
    const initialOwnership = st.initialPostMoney > 0 ? st.initialCheck / st.initialPostMoney : 0
    const ownershipAtExit = initialOwnership * st.dilutionFactor
    return {
      ...st,
      initialOwnership,
      ownershipAtExit,
      exitToReturnFund: ownershipAtExit > 0 ? r(actuals.committedCapital / ownershipAtExit) : 0,
      allocation: r(st.deals * st.initialCheck * (1 + st.followOnMultiple)),
    }
  })

  const totalStageDeals = stageReturns.reduce((s, st) => s + st.deals, 0)
  const wAvgOwnershipAtExit = totalStageDeals > 0
    ? stageReturns.reduce((s, st) => s + st.ownershipAtExit * st.deals, 0) / totalStageDeals
    : null

  const requiredPortfolioValue = r(a.targetFundMultiple * actuals.committedCapital)

  const exitFor = (ownership: number): SensitivityRow => ({
    ownershipAtExit: ownership,
    // What the AVERAGE portfolio company must exit at, if every one of them reaches the target.
    avgExitForTargetReturn: a.targetPortfolioSize > 0
      ? r(requiredPortfolioValue / ownership / a.targetPortfolioSize)
      : 0,
    // What ONE company must exit at for the fund's stake in it to return the whole fund.
    exitToReturnFund: r(actuals.committedCapital / ownership),
    isWeightedAverage: false,
  })

  const returns: ReturnsBlock = {
    targetFundMultiple: a.targetFundMultiple,
    requiredPortfolioValue,
    impliedMultipleOnInvested: investable > 0
      ? Math.round((requiredPortfolioValue / investable) * 100) / 100
      : null,
    stages: stageReturns,
    wAvgOwnershipAtExit,
    avgExitForTargetReturn: wAvgOwnershipAtExit && wAvgOwnershipAtExit > 0 && a.targetPortfolioSize > 0
      ? r(requiredPortfolioValue / wAvgOwnershipAtExit / a.targetPortfolioSize)
      : null,
    exitToReturnFund: wAvgOwnershipAtExit && wAvgOwnershipAtExit > 0
      ? r(actuals.committedCapital / wAvgOwnershipAtExit)
      : null,
    sensitivity: [
      ...a.sensitivityOwnerships.map(exitFor),
      ...(wAvgOwnershipAtExit && wAvgOwnershipAtExit > 0
        ? [{ ...exitFor(wAvgOwnershipAtExit), isWeightedAverage: true }]
        : []),
    ],
  }

  return {
    capital: {
      committedCapital: r(actuals.committedCapital),
      feesIncurred: r(actuals.managementFeesIncurred),
      feesProjected,
      lifetimeFees,
      orgCostsIncurred: r(actuals.orgCostsIncurred),
      expensesIncurred: r(actuals.partnershipExpensesIncurred),
      expensesProjected,
      lifetimeExpenses,
      investable,
      ledgerAvailable: actuals.ledgerAvailable,
      deployedInitial: r(actuals.deployedInitial),
      deployedFollowOn: r(actuals.deployedFollowOn),
      deployedTotal,
      existingReservePool: r(a.existingReservePool),
      remaining,
      companyCount: actuals.companyCount,
      plannedNewDeals,
      plannedCost,
      gap,
      avgPerRemainingDeal: plannedNewDeals > 0 ? r(remaining / plannedNewDeals) : null,
    },
    returns,
    warnings,
  }
}
