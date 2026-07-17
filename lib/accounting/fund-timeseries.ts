// Fund growth over time — the time-series behind the /funds/[id] detail page's charts.
//
// Everything here is WHOLE-FUND and derived from the same two producers the rest of the
// section reads:
//
//   • LP capital postings (loadCapitalPostings) — dated, debit-positive deltas to partners'
//     equity accounts, bucketed by source_type. These give the net-of-fund cash flows
//     (called capital, distributions) and the NAV composition (contributions, gains,
//     expenses, …). Summed across EVERY partner, the reallocation buckets — carried interest,
//     transfers, unclassified — net to ~zero, so a whole-fund series leaks none of the GP's
//     economics and needs no gp_economics gate. `ending` NAV is the raw cumulative sum of the
//     deltas, so the composition always ties to the ledger.
//
//   • The portfolio tracker (computeSummary, the canonical roll-up in lib/investments.ts) —
//     re-valued AS OF each period end. This gives the GROSS, deal-level view: capital invested
//     into companies and proceeds returned from them, which is a different thing from the LPs'
//     called capital and distributions.
//
// The grid is quarterly. Each point carries CUMULATIVE (inception-to-period-end) figures so the
// charts read as growth curves rather than per-quarter flows.

import type { SupabaseClient } from '@supabase/supabase-js'
import { roundCents } from './ledger'
import { loadCapitalPostings } from './capital-source'
import { bucketForSourceType } from './capital-account'
import { txnsForVehicle } from './soi'
import { computeSummary } from '@/lib/investments'
import type { InvestmentTransaction, CompanyStatus } from '@/lib/types/database'

export interface FundTimeseriesPoint {
  /** Quarter-end date (YYYY-MM-DD). */
  period: string
  /** Short label, e.g. "Q1 '24". */
  label: string

  // ── Net, from LP capital accounts (cumulative) ────────────────────────────
  /** Called (paid-in) capital to date. */
  calledCapital: number
  /** Capital returned to partners to date (positive). */
  distributed: number

  // ── NAV composition (cumulative, signed so the segments sum to `nav`) ──────
  contributions: number
  /** Negative — capital returned reduces NAV. */
  distributions: number
  operatingIncome: number
  realizedGains: number
  unrealizedGains: number
  /** Negative — management fees + partnership expenses. */
  expenses: number
  /** Transfers + FX translation + anything unclassified. Nets to ~0 whole-fund. */
  other: number
  /** = sum of the composition segments = ending partners' capital. */
  nav: number

  // ── Gross, from the portfolio tracker (cumulative, as of the period) ───────
  /** Capital deployed into companies to date. */
  investedCapital: number
  /** Proceeds realized from companies to date. */
  proceeds: number
  /** Carrying value of the portfolio at the period end. */
  portfolioValue: number
}

export interface FundTimeseries {
  points: FundTimeseriesPoint[]
  /** True once the vehicle holds any tracked investment — drives the gross toggle. */
  hasGross: boolean
}

const r = roundCents

/** Last calendar day of the quarter containing `d`, as YYYY-MM-DD (UTC). */
function quarterEndOf(d: Date): string {
  const y = d.getUTCFullYear()
  const endMonth = Math.floor(d.getUTCMonth() / 3) * 3 + 2 // 2, 5, 8, 11
  return new Date(Date.UTC(y, endMonth + 1, 0)).toISOString().slice(0, 10)
}

function quarterLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  const q = Math.floor(d.getUTCMonth() / 3) + 1
  return `Q${q} '${String(d.getUTCFullYear()).slice(2)}`
}

/** Every quarter-end from the quarter containing `start` through `end`, inclusive. Capped. */
export function quarterEndsThrough(start: string, end: string): string[] {
  const out: string[] = []
  let cur = quarterEndOf(new Date(start + 'T00:00:00Z'))
  while (cur <= end && out.length < 80) {
    out.push(cur)
    const next = new Date(new Date(cur + 'T00:00:00Z').getTime() + 86_400_000)
    cur = quarterEndOf(next)
  }
  // The reporting date itself may fall mid-quarter — make sure it's represented so the
  // curve ends on "now" rather than on the last completed quarter.
  const endQ = quarterEndOf(new Date(end + 'T00:00:00Z'))
  if (out.length > 0 && out[out.length - 1] !== endQ && endQ > out[out.length - 1] && out.length < 80) {
    out.push(endQ)
  }
  return out
}

/** The capital-account half of a point — everything derivable from LP postings alone. */
export type CapitalSeriesPoint = Omit<FundTimeseriesPoint, 'investedCapital' | 'proceeds' | 'portfolioValue'>

/** A capital posting, narrowed to what the series needs. */
interface SeriesPosting { entryDate?: string | null; sourceType?: string | null; amount: number }

/**
 * The pure capital-account time-series: bucket dated postings into quarters, then roll them
 * forward into cumulative points. DB-free and deterministic, so the bucketing and the NAV
 * tie-out can be pinned by a test. `quarters` are the quarter-end dates to report, in order.
 */
export function buildCapitalSeries(postings: SeriesPosting[], quarters: string[]): CapitalSeriesPoint[] {
  if (quarters.length === 0) return []

  const zero = () => ({
    contributions: 0, distributions: 0, operatingIncome: 0, realizedGains: 0,
    unrealizedGains: 0, expenses: 0, other: 0,
  })
  const perQuarter = new Map<string, ReturnType<typeof zero>>(quarters.map(q => [q, zero()]))

  // The first quarter-end on or after `date` — the quarter that posting lands in.
  const quarterFor = (date: string): string => {
    for (const q of quarters) if (date <= q) return q
    return quarters[quarters.length - 1] // shouldn't happen (postings are asOf-scoped); clamp anyway
  }

  for (const p of postings) {
    // Undated postings (rare) anchor to the first quarter so they still count toward NAV.
    const bucket = perQuarter.get(quarterFor(p.entryDate ?? quarters[0]))
    if (!bucket) continue
    const delta = -p.amount // credit increases capital
    switch (bucketForSourceType(p.sourceType)) {
      case 'contributions': bucket.contributions += delta; break
      case 'distributions': bucket.distributions += delta; break
      case 'operatingIncome': bucket.operatingIncome += delta; break
      case 'realizedGains': bucket.realizedGains += delta; break
      case 'unrealizedGains': bucket.unrealizedGains += delta; break
      case 'managementFees':
      case 'expenses': bucket.expenses += delta; break
      // beginning/transfers/carriedInterest/fxTranslation/unclassified — reallocations and
      // opening balances that net to ~0 whole-fund. Kept on one line so the stack still ties.
      default: bucket.other += delta; break
    }
  }

  const running = zero()
  return quarters.map(q => {
    const d = perQuarter.get(q)!
    running.contributions += d.contributions
    running.distributions += d.distributions
    running.operatingIncome += d.operatingIncome
    running.realizedGains += d.realizedGains
    running.unrealizedGains += d.unrealizedGains
    running.expenses += d.expenses
    running.other += d.other

    const nav = r(running.contributions + running.distributions + running.operatingIncome +
      running.realizedGains + running.unrealizedGains + running.expenses + running.other)

    return {
      period: q,
      label: quarterLabel(q),
      calledCapital: r(running.contributions),
      distributed: r(-running.distributions),
      contributions: r(running.contributions),
      distributions: r(running.distributions),
      operatingIncome: r(running.operatingIncome),
      realizedGains: r(running.realizedGains),
      unrealizedGains: r(running.unrealizedGains),
      expenses: r(running.expenses),
      other: r(running.other),
      nav,
    }
  })
}

/**
 * Whole-fund growth time-series for one vehicle.
 *
 * `asOf` (YYYY-MM-DD) caps the series; it defaults to today. A vehicle with no capital and no
 * tracked investments returns an empty series rather than a flat line of zeroes.
 */
export async function fundTimeseries(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  asOf?: string,
): Promise<FundTimeseries> {
  const endDate = asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : new Date().toISOString().slice(0, 10)

  const [{ postings }, { data: txnRows }, { data: companyRows }] = await Promise.all([
    loadCapitalPostings(admin, fundId, group, endDate),
    admin.from('investment_transactions' as any).select('*').eq('fund_id', fundId),
    admin.from('companies' as any).select('*').eq('fund_id', fundId),
  ])

  const txns = ((txnRows as InvestmentTransaction[]) ?? [])
  const companies = ((companyRows as any[]) ?? [])

  // Companies this vehicle actually holds — same test the schedule of investments uses.
  const byCompany = new Map<string, InvestmentTransaction[]>()
  for (const t of txns) {
    if (!byCompany.has(t.company_id)) byCompany.set(t.company_id, [])
    byCompany.get(t.company_id)!.push(t)
  }
  const held = companies
    .map(c => ({ status: (c.status ?? 'active') as CompanyStatus, relevant: txnsForVehicle(byCompany.get(c.id) ?? [], group) }))
    .filter(c => c.relevant.some(t => t.transaction_type === 'investment' && t.portfolio_group === group))

  // Earliest activity across both producers — where the curve should start.
  const postingDates = postings.map(p => p.entryDate).filter((d): d is string => !!d)
  const txnDates = held.flatMap(c => c.relevant.map(t => t.transaction_date).filter((d): d is string => !!d))
  const allDates = [...postingDates, ...txnDates].filter(d => d <= endDate).sort()
  if (allDates.length === 0) return { points: [], hasGross: held.length > 0 }

  const quarters = quarterEndsThrough(allDates[0], endDate)
  const capital = buildCapitalSeries(postings, quarters)

  // Layer the gross (deal-level) view on: re-value the tracker AS OF each quarter end.
  // computeSummary is the canonical valuation — deliberately not re-derived here.
  const points: FundTimeseriesPoint[] = capital.map(pt => {
    const asOfDate = new Date(pt.period + 'T00:00:00Z')
    let investedCapital = 0, proceeds = 0, portfolioValue = 0
    for (const c of held) {
      const s = computeSummary(c.relevant, c.status, asOfDate)
      investedCapital += s.totalInvested
      proceeds += s.totalRealized
      portfolioValue += s.unrealizedValue
    }
    return {
      ...pt,
      investedCapital: r(investedCapital),
      proceeds: r(proceeds),
      portfolioValue: r(portfolioValue),
    }
  })

  return { points, hasGross: held.length > 0 }
}
