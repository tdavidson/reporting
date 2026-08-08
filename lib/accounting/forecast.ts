// Monte Carlo forecast for a vehicle: stochastic exit outcomes for the positions the
// vehicle already holds, plus a forecast pipeline of new investments, replayed a few
// thousand times to produce distributions instead of a single guess.
//
// The sampling primitives (Mulberry32, Box-Muller, mean-anchored lognormal, per-tier σ
// scaled by log(1 + multiple)) are ported from the Fund Economics Tool's Monte Carlo in
// the content repo (lib/fund-economics/mc.ts) so the two properties simulate the same
// way: tier multiples are treated as EXPECTED values, so the simulation's mean
// reconciles to the deterministic Σ(pct × multiple), and large-multiple tiers get
// power-law tails while small ones cluster tight around their stated multiple.
//
// The engine is pure — no I/O, no clock. `asOf` and `seed` are inputs, so a saved
// scenario (assumptions + seed) reproduces its simulation exactly. That is what makes a
// scenario a stable "plan" to compare actuals against later (plans/plan-accounting-
// forecasting.md).
//
// Existing positions enter at their CURRENT FAIR VALUE (the SOI's per-company roll-up),
// not cost: the mark already embeds the company's progress, so the outcome tiers here
// answer "what happens to today's value", and their defaults are deliberately tamer
// than the classic power-law-on-cost tiers used for the new-investment pipeline.

import { xirr, type CashFlow } from '@/lib/xirr'

// ── RNG + sampling primitives ────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function standardNormal(rng: () => number): number {
  const u = Math.max(1e-12, rng())
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Lognormal draw with `mean` as the arithmetic expected value (μ = ln(mean) − σ²/2). */
function lognormal(rng: () => number, mean: number, sigma: number): number {
  if (mean <= 0) return 0
  const mu = Math.log(mean) - (sigma * sigma) / 2
  return Math.exp(mu + sigma * standardNormal(rng))
}

/** Pick an index from weights (not required to sum to 1). */
function pickIndex(rng: () => number, weights: number[]): number {
  let total = 0
  for (const w of weights) total += Math.max(0, w)
  if (total <= 0) return 0
  let u = rng() * total
  for (let i = 0; i < weights.length; i++) {
    u -= Math.max(0, weights[i])
    if (u <= 0) return i
  }
  return weights.length - 1
}

/** Uniform integer in [lo, hi] inclusive. */
function uniformInt(rng: () => number, lo: number, hi: number): number {
  if (hi <= lo) return lo
  return lo + Math.floor(rng() * (hi - lo + 1))
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface ForecastTier {
  label: string
  /** Probability weight: share of positions that land in this tier. */
  pct: number
  /** Expected multiple for the tier — of fair value for existing positions, of cost for new. */
  multiple: number
}

export interface ForecastPosition {
  name: string
  companyId?: string
  /** Current fair value — the base the outcome multiple applies to. */
  fairValue: number
  /** Remaining cost basis, used only to split exit proceeds into cost released vs realized gain. */
  cost: number
}

/** The vehicle's actuals to date, used for denominators and the prior value already returned. */
export interface ForecastFundBase {
  committed: number
  paidIn: number
  /** Capital already returned to partners (actuals to date). */
  distributions: number
}

export interface HoldWindow {
  minYears: number
  maxYears: number
}

export interface ForecastAssumptions {
  /** Simulation start (YYYY-MM-DD). Everything is quarters from here. */
  asOf: string
  horizonYears: number
  existing: {
    tiers: ForecastTier[]
    hold: HoldWindow
  }
  newInvestments: {
    count: number
    averageCheck: number
    /** New checks deploy evenly over this many years from asOf. */
    deploymentYears: number
    tiers: ForecastTier[]
    hold: HoldWindow
  }
  /** Annual management fee + expense drag, as a fraction of committed (e.g. 0.02). */
  annualFeesPct: number
  /** Years the fee drag keeps running from asOf. */
  feeYears: number
}

export interface ForecastOptions {
  /** Default 2000, capped at 10000. */
  iterations?: number
  seed?: number
  /** Lognormal σ at the highest-multiple tier; smaller tiers scale by log(1+m). Default 1.0. */
  multipleSigma?: number
}

// ── Outputs ──────────────────────────────────────────────────────────────────

export interface ForecastDistribution {
  p5: number
  p25: number
  p50: number
  p75: number
  p95: number
  mean: number
  stdev: number
}

export interface QuarterBand extends ForecastDistribution {
  /** Quarter-end date (YYYY-MM-DD). */
  date: string
}

export interface ExpectedQuarter {
  date: string
  /** Capital called from partners this quarter (new investment cost + fees). */
  called: number
  fees: number
  invested: number
  /** Exit proceeds received this quarter. */
  proceeds: number
  /** Cost basis released by those exits (proceeds − costReleased = realized gain). */
  costReleased: number
  /** Cash passed straight through to partners (= proceeds in v1). */
  distributed: number
  /** End-of-quarter NAV of the forecast portfolio. */
  nav: number
}

export interface ExpectedPath {
  quarters: ExpectedQuarter[]
  terminalNav: number
  tvpi: number | null
  dpi: number | null
}

export interface ForecastResult {
  iterations: number
  seed: number
  multipleSigma: number
  /** Quarter-end dates for the path bands. */
  quarterDates: string[]
  /** NAV percentile band per quarter. */
  nav: QuarterBand[]
  /** Cumulative forecast distributions percentile band per quarter. */
  cumDistributions: QuarterBand[]
  tvpi: ForecastDistribution & { samples: number[] }
  dpi: ForecastDistribution
  /** Forward IRR from asOf: today's NAV is the opening outflow. */
  irr: ForecastDistribution
  /** P(TVPI < 1) — the fund returns less than its (actual + forecast) paid-in. */
  probBelowCapital: number
  denominator: {
    paidIn: number
    newCapital: number
    fees: number
    total: number
    /** 'paid_in' normally; 'fair_value' when the vehicle has no recorded paid-in. */
    source: 'paid_in' | 'fair_value'
  }
  expected: ExpectedPath
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const r2 = (n: number) => Math.round(n * 100) / 100

/** End-of-quarter date for 0-indexed quarter q, counted from asOf (same construction as
 *  the content repo's journal-from-quarterly). */
export function quarterEndDate(asOf: string, q: number): string {
  const d = new Date(asOf + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + (q + 1) * 3)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function summarize(samples: number[]): ForecastDistribution {
  const sorted = [...samples].sort((a, b) => a - b)
  const n = sorted.length
  const pct = (p: number) => {
    if (n === 0) return 0
    const idx = Math.max(0, Math.min(n - 1, Math.floor(p * (n - 1))))
    return sorted[idx]
  }
  const mean = n > 0 ? samples.reduce((s, x) => s + x, 0) / n : 0
  const variance = n > 0 ? samples.reduce((s, x) => s + (x - mean) ** 2, 0) / n : 0
  return { p5: pct(0.05), p25: pct(0.25), p50: pct(0.5), p75: pct(0.75), p95: pct(0.95), mean, stdev: Math.sqrt(variance) }
}

/** Per-tier σ, scaled so `sigma` is the σ at the highest-multiple tier (mc.ts scaling). */
function tierSigmas(tiers: ForecastTier[], sigma: number): number[] {
  const maxMultiple = Math.max(...tiers.map(t => t.multiple), 0)
  const maxLog = Math.log(1 + maxMultiple)
  return tiers.map(t => (t.multiple <= 0 || maxLog === 0 ? 0 : sigma * (Math.log(1 + t.multiple) / maxLog)))
}

/** Expected multiple across tiers, normalized by total weight. */
export function expectedMultiple(tiers: ForecastTier[]): number {
  const total = tiers.reduce((s, t) => s + Math.max(0, t.pct), 0)
  if (total <= 0) return 0
  return tiers.reduce((s, t) => s + Math.max(0, t.pct) * t.multiple, 0) / total
}

/** Hold window in quarter indexes (the quarter the exit lands in), clamped sane. */
function holdQuarters(hold: HoldWindow): { lo: number; hi: number } {
  const lo = Math.max(0, Math.round(hold.minYears * 4) - 1)
  const hi = Math.max(lo, Math.round(hold.maxYears * 4) - 1)
  return { lo, hi }
}

/**
 * Value of a position part-way to its drawn exit. Geometric interpolation from the
 * current mark to the exit value, so the NAV path curves rather than stair-stepping —
 * a position drawn at 4x drifts up each quarter instead of jumping on exit day.
 * Write-offs (multiple 0) decay linearly to zero instead (no geometric path to 0).
 */
function interpValue(base: number, mult: number, q: number, exitQ: number): number {
  const frac = Math.min(1, (q + 1) / (exitQ + 1))
  if (mult <= 0) return base * (1 - frac)
  return base * Math.pow(mult, frac)
}

// ── Default assumptions ──────────────────────────────────────────────────────

/** Tamer tiers for positions already marked: the mark embeds progress to date. */
export const DEFAULT_EXISTING_TIERS: ForecastTier[] = [
  { label: 'Write-off', pct: 0.2, multiple: 0 },
  { label: 'Below the mark', pct: 0.3, multiple: 0.6 },
  { label: 'At the mark', pct: 0.3, multiple: 1.2 },
  { label: 'Above the mark', pct: 0.15, multiple: 3 },
  { label: 'Outlier', pct: 0.05, multiple: 8 },
]

/** Classic power-law-on-cost tiers for the new-investment pipeline. */
export const DEFAULT_NEW_TIERS: ForecastTier[] = [
  { label: 'Write-off', pct: 0.4, multiple: 0 },
  { label: 'Return capital', pct: 0.3, multiple: 1 },
  { label: 'Mid case', pct: 0.2, multiple: 3 },
  { label: 'Winner', pct: 0.08, multiple: 10 },
  { label: 'Outlier', pct: 0.02, multiple: 30 },
]

export function defaultAssumptions(asOf: string): ForecastAssumptions {
  return {
    asOf,
    horizonYears: 8,
    existing: { tiers: DEFAULT_EXISTING_TIERS, hold: { minYears: 1, maxYears: 6 } },
    newInvestments: {
      count: 0,
      averageCheck: 0,
      deploymentYears: 2,
      tiers: DEFAULT_NEW_TIERS,
      hold: { minYears: 3, maxYears: 8 },
    },
    annualFeesPct: 0,
    feeYears: 0,
  }
}

// ── Deterministic schedule shared by both runs ───────────────────────────────

interface NewCheck {
  cost: number
  investQ: number
}

/** New checks deploy evenly across the deployment window; the SCHEDULE is deterministic,
 *  only the outcomes are stochastic. */
function newCheckSchedule(a: ForecastAssumptions, quarters: number): NewCheck[] {
  const n = Math.max(0, Math.round(a.newInvestments.count))
  if (n === 0 || a.newInvestments.averageCheck <= 0) return []
  const deployQ = Math.max(1, Math.min(quarters, Math.round(a.newInvestments.deploymentYears * 4)))
  const checks: NewCheck[] = []
  for (let k = 0; k < n; k++) {
    checks.push({ cost: a.newInvestments.averageCheck, investQ: Math.min(deployQ - 1, Math.floor((k * deployQ) / n)) })
  }
  return checks
}

function feeSchedule(a: ForecastAssumptions, base: ForecastFundBase, quarters: number): number[] {
  const perQuarter = (base.committed * a.annualFeesPct) / 4
  const feeQ = Math.min(quarters, Math.round(a.feeYears * 4))
  return Array.from({ length: quarters }, (_, q) => (q < feeQ && perQuarter > 0 ? perQuarter : 0))
}

// ── Main driver ──────────────────────────────────────────────────────────────

export function runForecast(
  positions: ForecastPosition[],
  base: ForecastFundBase,
  assumptions: ForecastAssumptions,
  options: ForecastOptions = {},
): ForecastResult {
  const iterations = Math.max(1, Math.min(10000, Math.round(options.iterations ?? 2000)))
  const seed = options.seed ?? 1
  const sigma = options.multipleSigma ?? 1.0
  const rng = mulberry32(seed)

  const Q = Math.max(4, Math.round(assumptions.horizonYears * 4))
  const quarterDates = Array.from({ length: Q }, (_, q) => quarterEndDate(assumptions.asOf, q))

  const live = positions.filter(p => p.fairValue > 0)
  const existingBase = live.reduce((s, p) => s + p.fairValue, 0)
  const exSigmas = tierSigmas(assumptions.existing.tiers, sigma)
  const exWeights = assumptions.existing.tiers.map(t => t.pct)
  const exHold = holdQuarters(assumptions.existing.hold)

  const checks = newCheckSchedule(assumptions, Q)
  const newSigmas = tierSigmas(assumptions.newInvestments.tiers, sigma)
  const newWeights = assumptions.newInvestments.tiers.map(t => t.pct)
  const newHold = holdQuarters(assumptions.newInvestments.hold)

  const fees = feeSchedule(assumptions, base, Q)
  const totalFees = fees.reduce((s, f) => s + f, 0)
  const newCapital = checks.reduce((s, c) => s + c.cost, 0)

  // Forecast paid-in = actual paid-in + everything the forecast still calls. A tracking
  // vehicle with no recorded paid-in falls back to today's fair value as the base, so the
  // multiple still means something rather than dividing by zero.
  const denomSource: 'paid_in' | 'fair_value' = base.paidIn > 0 ? 'paid_in' : 'fair_value'
  const denomBase = denomSource === 'paid_in' ? base.paidIn : existingBase
  const denomTotal = denomBase + newCapital + totalFees

  const navSamples: number[][] = Array.from({ length: Q }, () => new Array<number>(iterations))
  const cumDistSamples: number[][] = Array.from({ length: Q }, () => new Array<number>(iterations))
  const tvpiSamples = new Array<number>(iterations)
  const dpiSamples = new Array<number>(iterations)
  const irrSamples: number[] = []

  const asOfDate = new Date(assumptions.asOf + 'T00:00:00Z')
  const quarterDateObjs = quarterDates.map(d => new Date(d + 'T00:00:00Z'))

  for (let it = 0; it < iterations; it++) {
    // Per-quarter flows for this iteration.
    const proceeds = new Array<number>(Q).fill(0)
    // exits[q] collects { base, mult, exitQ } no — accumulate NAV directly.
    const nav = new Array<number>(Q).fill(0)

    // Existing positions.
    for (const p of live) {
      const tierIdx = pickIndex(rng, exWeights)
      const mult = lognormal(rng, assumptions.existing.tiers[tierIdx].multiple, exSigmas[tierIdx])
      const exitQ = uniformInt(rng, exHold.lo, exHold.hi)
      if (exitQ < Q) {
        proceeds[exitQ] += p.fairValue * mult
        for (let q = 0; q < exitQ; q++) nav[q] += interpValue(p.fairValue, mult, q, exitQ)
      } else {
        for (let q = 0; q < Q; q++) nav[q] += interpValue(p.fairValue, mult, q, exitQ)
      }
    }

    // New investments.
    for (const c of checks) {
      const tierIdx = pickIndex(rng, newWeights)
      const mult = lognormal(rng, assumptions.newInvestments.tiers[tierIdx].multiple, newSigmas[tierIdx])
      const exitQ = c.investQ + 1 + uniformInt(rng, newHold.lo, newHold.hi)
      if (exitQ < Q) {
        proceeds[exitQ] += c.cost * mult
        for (let q = c.investQ; q < exitQ; q++) nav[q] += interpValue(c.cost, mult, q - c.investQ, exitQ - c.investQ)
      } else {
        for (let q = c.investQ; q < Q; q++) nav[q] += interpValue(c.cost, mult, q - c.investQ, exitQ - c.investQ)
      }
    }

    let cum = 0
    for (let q = 0; q < Q; q++) {
      cum += proceeds[q]
      navSamples[q][it] = nav[q]
      cumDistSamples[q][it] = cum
    }

    const terminalNav = nav[Q - 1]
    const totalValue = base.distributions + cum + terminalNav
    tvpiSamples[it] = denomTotal > 0 ? totalValue / denomTotal : 0
    dpiSamples[it] = denomTotal > 0 ? (base.distributions + cum) / denomTotal : 0

    // Forward IRR: today's NAV is the opening outflow, future calls are outflows as they
    // happen, proceeds come back as they land, and whatever is still unrealized at the
    // horizon is a terminal inflow.
    const flows: CashFlow[] = [{ date: asOfDate, amount: -existingBase }]
    for (let q = 0; q < Q; q++) {
      const invested = checks.reduce((s, c) => s + (c.investQ === q ? c.cost : 0), 0)
      const net = proceeds[q] - invested - fees[q] + (q === Q - 1 ? terminalNav : 0)
      if (net !== 0) flows.push({ date: quarterDateObjs[q], amount: net })
    }
    const rate = xirr(flows)
    if (rate != null && Number.isFinite(rate)) irrSamples.push(rate)
  }

  const probBelowCapital = tvpiSamples.filter(t => t < 1).length / iterations

  return {
    iterations,
    seed,
    multipleSigma: sigma,
    quarterDates,
    nav: quarterDates.map((date, q) => ({ date, ...summarize(navSamples[q]) })),
    cumDistributions: quarterDates.map((date, q) => ({ date, ...summarize(cumDistSamples[q]) })),
    tvpi: { ...summarize(tvpiSamples), samples: tvpiSamples },
    dpi: summarize(dpiSamples),
    irr: summarize(irrSamples),
    probBelowCapital,
    denominator: { paidIn: base.paidIn, newCapital: r2(newCapital), fees: r2(totalFees), total: r2(denomTotal), source: denomSource },
    expected: buildExpectedPath(positions, base, assumptions),
  }
}

// ── Expected (deterministic) path ────────────────────────────────────────────

/**
 * One deterministic replay at tier means and midpoint holds — the single schedule the
 * forecast journal entries are generated from. Runs the same mechanics as an iteration
 * with every draw pinned to its expectation.
 */
export function buildExpectedPath(
  positions: ForecastPosition[],
  base: ForecastFundBase,
  assumptions: ForecastAssumptions,
): ExpectedPath {
  const Q = Math.max(4, Math.round(assumptions.horizonYears * 4))
  const live = positions.filter(p => p.fairValue > 0)

  const exMult = expectedMultiple(assumptions.existing.tiers)
  const exHold = holdQuarters(assumptions.existing.hold)
  const exExitQ = Math.round((exHold.lo + exHold.hi) / 2)

  const newMult = expectedMultiple(assumptions.newInvestments.tiers)
  const newHold = holdQuarters(assumptions.newInvestments.hold)
  const newHoldQ = Math.round((newHold.lo + newHold.hi) / 2)

  const checks = newCheckSchedule(assumptions, Q)
  const fees = feeSchedule(assumptions, base, Q)

  const invested = new Array<number>(Q).fill(0)
  const proceeds = new Array<number>(Q).fill(0)
  const costReleased = new Array<number>(Q).fill(0)
  const nav = new Array<number>(Q).fill(0)

  for (const p of live) {
    if (exExitQ < Q) {
      proceeds[exExitQ] += p.fairValue * exMult
      costReleased[exExitQ] += p.cost
      for (let q = 0; q < exExitQ; q++) nav[q] += interpValue(p.fairValue, exMult, q, exExitQ)
    } else {
      for (let q = 0; q < Q; q++) nav[q] += interpValue(p.fairValue, exMult, q, exExitQ)
    }
  }

  for (const c of checks) {
    invested[c.investQ] += c.cost
    const exitQ = c.investQ + 1 + newHoldQ
    if (exitQ < Q) {
      proceeds[exitQ] += c.cost * newMult
      costReleased[exitQ] += c.cost
      for (let q = c.investQ; q < exitQ; q++) nav[q] += interpValue(c.cost, newMult, q - c.investQ, exitQ - c.investQ)
    } else {
      for (let q = c.investQ; q < Q; q++) nav[q] += interpValue(c.cost, newMult, q - c.investQ, exitQ - c.investQ)
    }
  }

  const quarters: ExpectedQuarter[] = []
  let cumProceeds = 0
  for (let q = 0; q < Q; q++) {
    cumProceeds += proceeds[q]
    quarters.push({
      date: quarterEndDate(assumptions.asOf, q),
      called: r2(invested[q] + fees[q]),
      fees: r2(fees[q]),
      invested: r2(invested[q]),
      proceeds: r2(proceeds[q]),
      costReleased: r2(costReleased[q]),
      distributed: r2(proceeds[q]),
      nav: r2(nav[q]),
    })
  }

  const totalFees = fees.reduce((s, f) => s + f, 0)
  const newCapital = checks.reduce((s, c) => s + c.cost, 0)
  const existingBase = live.reduce((s, p) => s + p.fairValue, 0)
  const denomBase = base.paidIn > 0 ? base.paidIn : existingBase
  const denomTotal = denomBase + newCapital + totalFees
  const terminalNav = nav[Q - 1]

  return {
    quarters,
    terminalNav: r2(terminalNav),
    tvpi: denomTotal > 0 ? (base.distributions + cumProceeds + terminalNav) / denomTotal : null,
    dpi: denomTotal > 0 ? (base.distributions + cumProceeds) / denomTotal : null,
  }
}

// ── Forecast journal entries (plain-text preview) ────────────────────────────

/**
 * Render the expected path as draft plain-text journal entries in this repo's ledger
 * text format (ACCOUNTING.md → "Authoring in text"). Every entry uses the `!` draft
 * flag: this is a preview of what the forecast implies the books would record, never
 * something to post as actuals. v2 turns these into first-class forecast entries the
 * statements can blend in (see plans/plan-accounting-forecasting.md).
 *
 * Exit entries book proceeds − cost released through 4000 Realized gains in one line;
 * the reversal of previously-booked unrealized appreciation (1200/4200) is deliberately
 * not modelled in the preview.
 */
export function forecastLedgerText(expected: ExpectedPath): string {
  const money = (n: number) => n.toFixed(2)
  const lines: string[] = [
    '; FORECAST — generated from scenario assumptions.',
    '; Draft entries (!) only: review, adjust, and never post as actuals.',
    '',
  ]
  let quarterIndex = 0
  for (const q of expected.quarters) {
    quarterIndex += 1
    const label = `Q${quarterIndex}`
    const hasActivity = q.called > 0 || q.fees > 0 || q.invested > 0 || q.proceeds > 0 || q.distributed > 0
    if (!hasActivity) continue

    if (q.called > 0.005) {
      lines.push(
        `${q.date} ! "Forecast capital call — ${label}"`,
        `  Assets:Cash:1000                         ${money(q.called)} USD`,
        `  Equity:Partners-Capital:3100            ${money(-q.called)} USD`,
        '',
      )
    }
    if (q.fees > 0.005) {
      lines.push(
        `${q.date} ! "Forecast management fee & expenses — ${label}"`,
        `  Expenses:Management-Fee:5000             ${money(q.fees)} USD`,
        `  Assets:Cash:1000                        ${money(-q.fees)} USD`,
        '',
      )
    }
    if (q.invested > 0.005) {
      lines.push(
        `${q.date} ! "Forecast investment deployment — ${label}"`,
        `  Assets:Investments-At-Cost:1100          ${money(q.invested)} USD`,
        `  Assets:Cash:1000                        ${money(-q.invested)} USD`,
        '',
      )
    }
    if (q.proceeds > 0.005) {
      // Round the cash and cost legs, plug the gain leg so the entry balances exactly.
      // A negative gain is a realized loss and posts as a debit on 4000 — signed
      // amounts make that fall out without a special case.
      const cash = r2(q.proceeds)
      const cost = r2(q.costReleased)
      const gain = r2(cash - cost)
      lines.push(
        `${q.date} ! "Forecast exit proceeds — ${label}"`,
        `  Assets:Cash:1000                         ${money(cash)} USD`,
        ...(cost > 0.005 ? [`  Assets:Investments-At-Cost:1100         ${money(-cost)} USD`] : []),
        ...(Math.abs(gain) > 0.005 ? [`  Income:Realized-Gains:4000              ${money(-gain)} USD`] : []),
        '',
      )
    }
    if (q.distributed > 0.005) {
      lines.push(
        `${q.date} ! "Forecast distribution — ${label}"`,
        `  Equity:Partners-Capital:3100             ${money(q.distributed)} USD`,
        `  Assets:Cash:1000                        ${money(-q.distributed)} USD`,
        '',
      )
    }
  }
  return lines.join('\n')
}
