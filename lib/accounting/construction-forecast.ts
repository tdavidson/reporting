// The time axis the construction model deliberately lacks.
//
// `constructionModel` (construction.ts) answers HOW MUCH: what remains, what the plan costs, what
// the portfolio has to return. It says nothing about WHEN — and its header says so, because a
// chart with a date axis would otherwise be inventing a schedule. This module is where that
// schedule is STATED rather than inferred: how many years the remaining checks are written over,
// how long after each initial check its follow-on comes, how long a deal is held, how long the
// existing book has left. Given those, the same forecast proceeds the model already computes fall
// onto years, and the fund gets a J-curve, DPI and TVPI by year, and a net IRR.
//
// PURE, like the model. Runs on the server for the agent and in the browser on every keystroke.
//
// WHAT IS NOT MODELLED. Proceeds are gross to the fund, before carry, so the multiples here are
// fund-level TVPI and DPI on called capital — not an LP's net-of-carry number. Capital is called as
// it is needed (investments, fees and expenses in each year), which is how most funds actually
// draw; a fund that front-loads calls will show a steeper early J than this. NAV between today and
// an exit carries at cost (or current value) by default, with an optional straight-line accretion
// to the forecast proceeds — the accreting view is the more familiar picture, the flat one the more
// honest one, and the page offers both.

import type { ConstructionAssumptions, ConstructionResult, PacingAssumptions } from './construction'
import { projectFeesForYear, DEFAULT_PACING } from './construction'

export { DEFAULT_PACING }
export type { PacingAssumptions }

const r = (n: number) => Math.round(n * 100) / 100

/** Where the fund stands today — the year-0 point every curve starts from. */
export interface ForecastBaseline {
  /** YYYY-MM-DD. */
  asOf: string
  calledCapital: number
  /** Capital returned to partners to date (positive). */
  distributed: number
  nav: number
  /**
   * The dated history behind `calledCapital` and `distributed`, as partner-side flows in years
   * from today (negative = the past): called capital negative, distributions positive. With it the
   * IRR is since inception; without it the past is one lump at today and the IRR reads forward.
   */
  historyFlows?: { t: number; amount: number }[]
}

/** One deal laid on the timeline, in years from today (fractional). */
export interface DealTimeline {
  key: string
  name: string
  kind: 'existing' | 'planned'
  /** Cost already deployed — sits in the past. */
  investedToDate: number
  /** Carrying value today (existing) or 0 (planned). */
  currentValue: number
  /** Initial check still to write, and when. Zero for an existing company. */
  initialCheck: number
  initialAt: number
  /** Follow-on still to write, and when. */
  followOn: number
  followOnAt: number
  /** Forecast proceeds and when they arrive. Null when the model has no forecast (an exited deal). */
  proceeds: number | null
  exitAt: number
  /** Whether the exit timing was stated for this deal or came from the fund-wide pacing. */
  timing: 'stated' | 'pacing'
  /** Per-deal simulation overrides, when stated. The simulation falls back to the fund-wide values. */
  lossRate?: number
  dispersion?: number
  exitSpreadYears?: number
}

export interface ForecastYear {
  /** Years from today; 0 is the baseline. */
  year: number
  /** Calendar year at the end of this period, e.g. 2029. */
  calendarYear: number
  // Flows in the year
  invested: number
  fees: number
  expenses: number
  called: number
  distributed: number
  // Cumulative at the year end
  cumCalled: number
  cumInvested: number
  cumDistributed: number
  nav: number
  dpi: number | null
  rvpi: number | null
  tvpi: number | null
  /** Net IRR on called capital through this year, with NAV as the terminal value. */
  netIrr: number | null
}

export interface ForecastSchedule {
  years: ForecastYear[]
  deals: DealTimeline[]
  horizonYears: number
  /** Committed capital the plan needs beyond what is uncalled, if any. */
  shortfall: number
  warnings: string[]
  /** True when the pacing assumptions say enough to place a single exit. */
  stated: boolean
}

/**
 * Lay the model's deals on the calendar.
 *
 * A deal's own timing wins when it is stated on the forecast: an existing company's years to exit,
 * a planned deal's year of investment and years to exit, and either one's follow-on timing.
 * Otherwise the fund-wide pacing applies: planned deals spread evenly over the deployment period
 * in the order entered (a period of zero writes every remaining check now), and the existing book
 * exits together at the stated remaining hold.
 */
export function dealTimelines(model: ConstructionResult, pacing: PacingAssumptions): DealTimeline[] {
  const stated = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
  const overrides = (f: { simLossRate?: number | null; simDispersion?: number | null; simExitSpreadYears?: number | null }) => ({
    ...(stated(f.simLossRate) ? { lossRate: f.simLossRate } : {}),
    ...(stated(f.simDispersion) ? { dispersion: f.simDispersion } : {}),
    ...(stated(f.simExitSpreadYears) ? { exitSpreadYears: f.simExitSpreadYears } : {}),
  })
  const out: DealTimeline[] = []
  for (const p of model.returns.positions) {
    const f = p.forecast
    const exitAt = Math.max(0, stated(f.exitInYears) ? f.exitInYears : pacing.existingHoldYears)
    const followOnAt = Math.max(0, stated(f.followOnInYears) ? f.followOnInYears : pacing.followOnLagYears)
    out.push({
      key: p.actual.companyId,
      name: p.actual.name,
      kind: 'existing',
      investedToDate: p.actual.investedTotal,
      currentValue: p.currentValue,
      initialCheck: 0,
      initialAt: 0,
      followOn: f.plannedFollowOn,
      followOnAt: Math.min(exitAt, followOnAt),
      proceeds: p.isForecasted ? p.estimatedReturn : null,
      exitAt,
      timing: stated(f.exitInYears) ? 'stated' : 'pacing',
      ...overrides(f),
    })
  }
  const n = model.returns.stages.length
  model.returns.stages.forEach((st, i) => {
    // The i-th of n deals lands at the centre of its slice of the deployment period.
    const spread = n > 0 && pacing.deploymentYears > 0 ? ((i + 0.5) / n) * pacing.deploymentYears : 0
    const initialAt = Math.max(0, stated(st.investInYears) ? st.investInYears : spread)
    const exitAt = initialAt + Math.max(0, stated(st.exitInYears) ? st.exitInYears : pacing.holdYears)
    const followOnLag = Math.max(0, stated(st.followOnInYears) ? st.followOnInYears : pacing.followOnLagYears)
    out.push({
      key: st.key,
      name: st.label || 'New investment',
      kind: 'planned',
      investedToDate: 0,
      currentValue: 0,
      initialCheck: st.plannedInitial,
      initialAt,
      followOn: st.plannedFollowOn,
      followOnAt: Math.min(exitAt, initialAt + followOnLag),
      proceeds: st.estimatedReturn,
      exitAt,
      timing: stated(st.exitInYears) || stated(st.investInYears) ? 'stated' : 'pacing',
      ...overrides(st),
    })
  })
  return out
}

/** The year (1-based bucket) a fractional time-from-today falls in; time 0 is year 0. */
const yearOf = (t: number) => (t <= 0 ? 0 : Math.ceil(t - 1e-9))

/** A dated flow for the IRR: `t` in years (fractional, negative for the past). */
export interface TimedFlow { t: number; amount: number }

/**
 * Annualised IRR of dated flows, by bisection. Flows are from the partners' side: called capital
 * negative, distributions and terminal NAV positive. Null without a sign change or a time spread.
 * Bisection rather than Newton because the simulation calls this thousands of times and a bracket
 * search cannot run away on an awkward flow pattern.
 */
export function irrOf(flows: TimedFlow[]): number | null {
  const live = flows.filter(f => Math.abs(f.amount) > 0.005)
  if (live.length < 2) return null
  if (!live.some(f => f.amount < 0) || !live.some(f => f.amount > 0)) return null
  const t0 = Math.min(...live.map(f => f.t))
  const t1 = Math.max(...live.map(f => f.t))
  if (t1 - t0 < 1 / 365) return null
  const npv = (rate: number) => live.reduce((s, f) => s + f.amount / Math.pow(1 + rate, f.t - t0), 0)
  let lo = -0.99
  let hi = 10
  let fLo = npv(lo)
  const fHi = npv(hi)
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    const fMid = npv(mid)
    if (Math.abs(fMid) < 1e-7 || hi - lo < 1e-7) return mid
    if (fLo * fMid < 0) { hi = mid } else { lo = mid; fLo = fMid }
  }
  return (lo + hi) / 2
}

/**
 * The yearly schedule: what the plan calls, invests, spends, returns and holds in each year from
 * today, and the multiples and IRR that fall out of it.
 *
 * `proceedsOverride` lets the simulation replace each deal's proceeds and exit year with a sampled
 * outcome while reusing every other rule here, so the two never disagree about fees or pacing.
 */
export function forecastSchedule(
  model: ConstructionResult,
  a: ConstructionAssumptions,
  pacing: PacingAssumptions,
  baseline: ForecastBaseline,
  proceedsOverride?: Map<string, { proceeds: number; exitAt: number }>,
  /** Which years get an IRR. The simulation asks for the final year only; it is the slow part. */
  irr: 'all' | 'final' | 'none' = 'all',
): ForecastSchedule {
  const warnings: string[] = []
  const deals = dealTimelines(model, pacing).map(d => {
    const o = proceedsOverride?.get(d.key)
    return o && d.proceeds != null ? { ...d, proceeds: o.proceeds, exitAt: o.exitAt } : d
  })
  // Stated once the fund-wide pacing says anything, or any deal carries its own exit.
  const stated = pacing.holdYears > 0 || pacing.existingHoldYears > 0 || pacing.deploymentYears > 0
    || deals.some(d => d.timing === 'stated' && d.exitAt > 0)

  const lastExit = deals.reduce((m, d) => Math.max(m, d.exitAt, d.followOnAt, d.initialAt), 0)
  const horizonYears = Math.max(1, Math.ceil(pacing.horizonYears > 0 ? pacing.horizonYears : Math.max(lastExit, a.feeTermYears)))

  const baseYear = Number(baseline.asOf.slice(0, 4)) || new Date().getFullYear()
  const committed = model.capital.committedCapital
  const deployedTotal = model.capital.deployedTotal
  const accretion = pacing.accretion === 'none' ? 'none' : 'linear'

  // Per-year flows.
  const invested = new Array<number>(horizonYears + 1).fill(0)
  const proceeds = new Array<number>(horizonYears + 1).fill(0)
  for (const d of deals) {
    if (d.initialCheck > 0) invested[Math.min(horizonYears, yearOf(d.initialAt))] += d.initialCheck
    if (d.followOn > 0) invested[Math.min(horizonYears, yearOf(d.followOnAt))] += d.followOn
    if (d.proceeds != null && d.proceeds > 0 && d.exitAt <= horizonYears + 1e-9) proceeds[yearOf(d.exitAt)] += d.proceeds
  }

  const years: ForecastYear[] = []
  let cumCalled = baseline.calledCapital
  let cumInvested = deployedTotal
  let cumDistributed = baseline.distributed
  let uncalled = Math.max(0, committed - baseline.calledCapital)
  let shortfall = 0
  // Cash the fund holds beyond what it has invested and spent (called ahead of need at the baseline).
  let cash = Math.max(0, baseline.nav - deals.reduce((s, d) => s + d.currentValue, 0))
  // The past, for the IRR: dated when the caller has the dates, one lump at today otherwise.
  const history: TimedFlow[] = baseline.historyFlows && baseline.historyFlows.length > 0
    ? baseline.historyFlows
    : [{ t: 0, amount: -baseline.calledCapital + baseline.distributed }]
  const forward: TimedFlow[] = []

  const navAt = (t: number): number => {
    // Unexited deals carry at their value today (existing) or at cost (planned), optionally
    // accreting straight-line to the forecast proceeds between now and the exit.
    let v = 0
    for (const d of deals) {
      if (d.exitAt <= t + 1e-9 && d.proceeds != null) continue // exited by now
      const cost = d.currentValue
        + (d.initialCheck > 0 && d.initialAt <= t ? d.initialCheck : 0)
        + (d.followOn > 0 && d.followOnAt <= t ? d.followOn : 0)
      if (d.proceeds == null) { v += cost; continue }
      const start = d.kind === 'planned' ? d.initialAt : 0
      if (accretion === 'linear' && d.exitAt > start && t > start) {
        const frac = Math.min(1, (t - start) / (d.exitAt - start))
        // From what is at work to the forecast proceeds, once all the capital is in.
        const fullCost = d.currentValue + d.initialCheck + d.followOn
        v += cost + Math.max(0, d.proceeds - fullCost) * frac
      } else {
        v += cost
      }
    }
    return v
  }

  for (let t = 0; t <= horizonYears; t++) {
    const fees = t === 0 ? 0 : projectFeesForYear(a, committed, deployedTotal, baseline.nav, t)
    const expenses = t === 0 ? 0 : (t <= a.feeTermYears ? a.annualPartnershipExpense : 0) + (t === 1 ? a.remainingOrgCosts : 0)
    const inv = t === 0 ? 0 : invested[t]
    const dist = t === 0 ? 0 : proceeds[t]

    // Call what the year needs, from cash on hand first, then from uncalled commitments.
    let called = 0
    if (t > 0) {
      const need = inv + fees + expenses
      const fromCash = Math.min(cash, need)
      cash -= fromCash
      const draw = Math.min(uncalled, need - fromCash)
      called = draw
      uncalled -= draw
      const unmet = need - fromCash - draw
      if (unmet > 0.005) shortfall += unmet
      cumCalled += called
      cumInvested += inv
      // Proceeds go straight back out: the fund does not recycle.
      cumDistributed += dist
    }
    const nav = r(navAt(t) + cash)

    if (t > 0) forward.push({ t, amount: dist - called })
    const wantIrr = irr === 'all' || (irr === 'final' && t === horizonYears)
    const netIrr = t === 0 || !wantIrr ? null : irrOf([...history, ...forward, { t, amount: nav }])

    years.push({
      year: t,
      calendarYear: baseYear + t,
      invested: r(inv),
      fees: r(fees),
      expenses: r(expenses),
      called: r(called),
      distributed: r(dist),
      cumCalled: r(cumCalled),
      cumInvested: r(cumInvested),
      cumDistributed: r(cumDistributed),
      nav,
      dpi: cumCalled > 0 ? cumDistributed / cumCalled : null,
      rvpi: cumCalled > 0 ? nav / cumCalled : null,
      tvpi: cumCalled > 0 ? (cumDistributed + nav) / cumCalled : null,
      netIrr,
    })
  }

  if (shortfall > 0.005) {
    warnings.push(`The plan needs ${r(shortfall).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} more than the fund can still call.`)
  }
  const unexited = deals.filter(d => d.proceeds != null && d.exitAt > horizonYears + 1e-9).length
  if (unexited > 0) {
    warnings.push(`${unexited} deal${unexited === 1 ? '' : 's'} exit${unexited === 1 ? 's' : ''} after the ${horizonYears}-year horizon and still sit${unexited === 1 ? 's' : ''} in NAV at the end.`)
  }

  return { years, deals, horizonYears, shortfall: r(shortfall), warnings, stated }
}
