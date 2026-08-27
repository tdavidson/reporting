// Which dividends are qualified — K-1 box 6b, the part of box 6a taxed at capital-gains rates.
//
// An earlier pass declared this underivable and reported it as "left for the preparer". That was
// too quick. §1(h)(11) asks two questions, and this codebase can now answer both for the ordinary
// case, so it computes an answer and shows its working rather than declining.
//
//   1. IS THE PAYER QUALIFIED? A domestic C corporation always is. The "readily tradable on an
//      established US market" condition that people remember applies only to FOREIGN
//      corporations — which is why a private US portfolio company's dividend qualifies despite
//      having no market at all. `companies.country` answers this.
//
//   2. WAS THE STOCK HELD LONG ENOUGH? More than 60 days within the 121-day window beginning 60
//      days before the ex-dividend date. `lots.ts` gives acquisition dates and units, so this is
//      arithmetic.
//
// WHAT IS ASSUMED, listed because a preparer will want to check it rather than discover it:
//
//   * THE EX-DIVIDEND DATE. The books record when income was recognised, which for a private
//     company is the pay date and for a listed one is close to it. The ex-date is earlier, so the
//     window here is shifted late by that gap. For stock held years — every ordinary case — the
//     shift changes nothing. It can only matter for a dividend on stock acquired within roughly
//     four months of it, which is exactly when this returns `uncertain` anyway.
//   * ENTITY TYPE. `country` says where, not what. A REIT, a RIC paying non-qualified income, or
//     an LLC taxed as a partnership all look like a US company here. Rare in a venture portfolio,
//     never impossible, so a fund can override.
//
// Nothing here is silently assumed to qualify: anything failing a test, or missing the data to
// run one, comes back with the reason attached.

import { roundCents } from './ledger'

/** The §1(h)(11) holding-period test: more than 60 days inside a 121-day window. */
export const REQUIRED_DAYS = 60
export const WINDOW_DAYS = 121
/** The window opens 60 days before the ex-dividend date. */
export const WINDOW_OPENS_BEFORE = 60

export type QualifiedVerdict = 'qualified' | 'not_qualified' | 'uncertain'

export interface DividendLot {
  /** When the units were acquired. */
  acquired: string
  units: number
  /** When they were disposed of, or null if still held. Days after a sale do not count. */
  disposed?: string | null
}

export interface DividendFact {
  /** Identifier for reporting — a transaction id. */
  id: string
  companyId: string
  /** Date the income was recognised. Stands in for the ex-dividend date; see the header. */
  date: string
  amount: number
  /** ISO country of the payer, from `companies.country`. Null when never populated. */
  payerCountry: string | null
  /** 'company' | 'fund' | 'crypto' — a fund pays distributive share, not dividends. */
  holdingType: string | null
  /** The lots held at the dividend date. */
  lots: DividendLot[]
}

export interface DividendVerdict {
  id: string
  amount: number
  verdict: QualifiedVerdict
  reason: string
}

function daysBetween(a: string, b: string): number {
  const t1 = new Date(`${a}T00:00:00Z`).getTime()
  const t2 = new Date(`${b}T00:00:00Z`).getTime()
  if (Number.isNaN(t1) || Number.isNaN(t2)) return Number.NaN
  return Math.floor((t2 - t1) / 86_400_000)
}

const DAY = 86_400_000

function shift(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00Z`).getTime()
  if (Number.isNaN(t)) return date
  return new Date(t + days * DAY).toISOString().slice(0, 10)
}

/**
 * Days the stock was held inside the 121-day window around the dividend.
 *
 * The window spans 60 days before the dividend through 60 days after it. Two conventions decide
 * the count, and getting either wrong makes this useless:
 *
 *   * §1223 counts from the day AFTER acquisition, and counts the day of disposition. So a lot
 *     bought on the day the window opens is held for 60 of the window's first 61 days, not 61.
 *   * THE DAYS AFTER THE DIVIDEND COUNT TOO. An earlier version stopped at the dividend date on
 *     the grounds that later days "had not happened yet". That capped every lot at 60 and made
 *     the >60 test unsatisfiable, so every dividend came back uncertain — the answer looked
 *     cautious and was simply broken. A lot still held sixty days later has 121 days in the
 *     window, and that is the ordinary case.
 *
 * A lot sold inside the window stops counting on the day it was sold.
 */
export function daysHeldInWindow(
  acquired: string,
  dividendDate: string,
  disposed?: string | null,
): number {
  const windowStart = shift(dividendDate, -WINDOW_OPENS_BEFORE)
  const windowEnd = shift(dividendDate, WINDOW_DAYS - WINDOW_OPENS_BEFORE - 1)

  // Counting starts the day after acquisition, or when the window opens — whichever is later.
  const firstCounted = acquired >= windowStart ? shift(acquired, 1) : windowStart
  const lastCounted = disposed && disposed < windowEnd ? disposed : windowEnd

  const days = daysBetween(firstCounted, lastCounted)
  if (Number.isNaN(days) || days < 0) return 0
  return days + 1
}

/** A country whose corporations are qualified payers without the tradability test. */
export function isDomesticPayer(country: string | null): boolean {
  if (!country) return false
  const c = country.trim().toUpperCase()
  return c === 'US' || c === 'USA' || c === 'UNITED STATES'
}

export function classifyDividend(d: DividendFact): DividendVerdict {
  const base = { id: d.id, amount: roundCents(d.amount) }

  if (d.holdingType && d.holdingType !== 'company') {
    return {
      ...base,
      verdict: 'not_qualified',
      reason:
        d.holdingType === 'fund'
          ? 'Paid by a fund holding: a partnership distributes its distributive share, which is not a dividend.'
          : 'Not paid by a corporation, so §1(h)(11) does not apply.',
    }
  }

  if (!d.payerCountry) {
    return {
      ...base,
      verdict: 'uncertain',
      reason:
        'The payer’s country is not recorded, so whether it is a domestic corporation (always a ' +
        'qualified payer) or a foreign one (qualified only by treaty or tradability) cannot be ' +
        'determined. Set the company’s country.',
    }
  }

  if (!isDomesticPayer(d.payerCountry)) {
    return {
      ...base,
      verdict: 'uncertain',
      reason:
        `A ${d.payerCountry} payer qualifies only if it is treaty-eligible or its stock is ` +
        'readily tradable on a US market. Neither is recorded here, so this needs a decision.',
    }
  }

  const held = d.lots.reduce((max, l) => Math.max(max, daysHeldInWindow(l.acquired, d.date, l.disposed)), 0)
  if (d.lots.length === 0) {
    return {
      ...base,
      verdict: 'uncertain',
      reason: 'No lots were found at the dividend date, so the holding period cannot be tested.',
    }
  }
  if (held > REQUIRED_DAYS) {
    return {
      ...base,
      verdict: 'qualified',
      reason: `Domestic payer, and the stock was held ${held} days inside the ${WINDOW_DAYS}-day window — more than the ${REQUIRED_DAYS} required.`,
    }
  }

  return {
    ...base,
    verdict: 'uncertain',
    reason:
      `The stock was held only ${held} days inside the ${WINDOW_DAYS}-day window, and ` +
      `§1(h)(11) needs more than ${REQUIRED_DAYS}. Acquired too close to the dividend, sold too ` +
      'soon after it, or both.',
  }
}

export interface QualifiedDividendSummary {
  /** Box 6b: the amount that qualified. */
  qualified: number
  /** Reported separately so nothing is quietly rolled into 6b. */
  notQualified: number
  uncertain: number
  verdicts: DividendVerdict[]
}

export function summarizeQualifiedDividends(facts: DividendFact[]): QualifiedDividendSummary {
  const verdicts = facts.map(classifyDividend)
  const sum = (v: QualifiedVerdict) =>
    roundCents(verdicts.filter(x => x.verdict === v).reduce((s, x) => s + x.amount, 0))
  return {
    qualified: sum('qualified'),
    notQualified: sum('not_qualified'),
    uncertain: sum('uncertain'),
    verdicts,
  }
}
