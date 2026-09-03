// What a management company's dashboard shows, derived from its ledger.
//
// A fund's lead page answers "how is the portfolio doing" — TVPI, DPI, NAV, the schedule of
// investments. None of that exists for a management company, and putting it on the page as a row
// of dashes was the reason a manco needed a section of its own rather than a vehicle kind alone.
//
// A firm asks four questions about its operating entity, and this file answers exactly those:
//
//   1. HOW MUCH CASH IS THERE, and how long does it last. Cash on hand, and the burn behind it.
//   2. WHAT CAME IN AND WHAT WENT OUT, BY QUARTER. Revenue arrives quarterly (the management fee)
//      and costs run monthly, so the two only line up on a quarterly grid — which is also the grid
//      the firm budgets on. An annual total hides the timing problem entirely, and a monthly one
//      makes a fee that arrives in one month of three look like three months of volatility.
//   3. WHERE THE MONEY GOES. Expenses by account for the period, largest first, because on a manco
//      the answer is "people" and the interesting part is everything under that.
//   4. WHO OWES WHOM. Handled next door in intercompany.ts, and joined onto the response by the
//      route.
//
// Everything here is pure apart from `loadMancoOverview`, so the quarter bucketing and the burn
// arithmetic are testable without a database. See manco-overview.test.ts.

import type { SupabaseClient } from '@supabase/supabase-js'
import { roundCents } from './ledger'
import { loadPostedLedger } from './load'
import type { Account, Posting } from './types'

export interface QuarterCycle {
  /** `2026-Q1`. */
  key: string
  label: string
  year: number
  quarter: number
  revenue: number
  expenses: number
  /** revenue − expenses. Operating result for the quarter, accrual basis. */
  net: number
}

export interface ExpenseLine {
  code: string
  name: string
  amount: number
  /** Share of total expenses in the window, 0–1. Null when there are no expenses at all. */
  share: number | null
}

export interface MancoOverview {
  vehicle: string
  /** Cash across every cash-subtyped account, as of the end of the window. */
  cash: number
  /** Per cash account, so an operating balance and a reserve are not reported as one number. */
  cashAccounts: { code: string; name: string; balance: number }[]
  revenue: number
  expenses: number
  net: number
  quarters: QuarterCycle[]
  expenseLines: ExpenseLine[]
  /**
   * Average monthly CASH burn over the trailing window — expenses less the non-cash ones, divided
   * by the months covered. Null when there is not enough history to mean anything.
   */
  monthlyBurn: number | null
  /** cash / monthlyBurn, in months. Null when burn is null or non-positive (the firm is profitable). */
  runwayMonths: number | null
  /** True once the vehicle has any posted entry at all — the empty state turns on this, not on cash. */
  hasLedger: boolean
}

/**
 * Expense subtypes that are NOT cash going out of the door this month.
 *
 * Depreciation is the whole list today and the reason the list exists: a firm that bought its
 * office furniture three years ago is still expensing it, and counting that as burn understates
 * runway by however much it depreciates. Kept as a set rather than a single comparison so an
 * amortisation or an accrual-only subtype can join it without changing the arithmetic.
 */
const NON_CASH_EXPENSE_SUBTYPES = new Set(['depreciation', 'amortization'])

const CASH_SUBTYPE = 'cash'

/** `2026-05-14` → `2026-Q2`. */
export function quarterKey(date: string): string {
  const [y, m] = date.split('-')
  return `${y}-Q${Math.floor((Number(m) - 1) / 3) + 1}`
}

/**
 * Bucket a window's income and expense postings into quarters — including the EMPTY ones.
 *
 * The empty quarters are the point. A management company's revenue arrives in four lumps a year,
 * so a chart that plots only the quarters with activity draws a straight line through the gaps and
 * shows a firm with smooth income. Filling the range makes a missed or late fee visible as the hole
 * it is, which is the single most useful thing this view does.
 */
export function quarterCycles(
  accounts: Account[],
  postings: Posting[],
  window: { start: string; end: string },
): QuarterCycle[] {
  const type = new Map(accounts.map(a => [a.id, a.type]))
  const buckets = new Map<string, { revenue: number; expenses: number }>()

  for (const p of postings) {
    const date = p.entryDate
    if (!date || date < window.start || date > window.end) continue
    const t = type.get(p.accountId)
    if (t !== 'income' && t !== 'expense') continue
    const key = quarterKey(date)
    const b = buckets.get(key) ?? { revenue: 0, expenses: 0 }
    // Postings are signed debit-positive, so income arrives NEGATIVE (a credit) and is flipped to
    // read as a positive amount earned; expenses are already debits.
    if (t === 'income') b.revenue = roundCents(b.revenue - p.amount)
    else b.expenses = roundCents(b.expenses + p.amount)
    buckets.set(key, b)
  }

  const out: QuarterCycle[] = []
  for (const { year, quarter } of quartersBetween(window.start, window.end)) {
    const key = `${year}-Q${quarter}`
    const b = buckets.get(key) ?? { revenue: 0, expenses: 0 }
    out.push({
      key,
      label: `Q${quarter} ${year}`,
      year,
      quarter,
      revenue: b.revenue,
      expenses: b.expenses,
      net: roundCents(b.revenue - b.expenses),
    })
  }
  return out
}

/** Every quarter the window touches, inclusive, in order. */
function quartersBetween(start: string, end: string): { year: number; quarter: number }[] {
  const out: { year: number; quarter: number }[] = []
  let year = Number(start.slice(0, 4))
  let quarter = Math.floor((Number(start.slice(5, 7)) - 1) / 3) + 1
  const endYear = Number(end.slice(0, 4))
  const endQuarter = Math.floor((Number(end.slice(5, 7)) - 1) / 3) + 1
  // A malformed or inverted window yields nothing rather than looping forever.
  if (!Number.isFinite(year) || !Number.isFinite(endYear)) return out
  while (year < endYear || (year === endYear && quarter <= endQuarter)) {
    out.push({ year, quarter })
    quarter += 1
    if (quarter > 4) { quarter = 1; year += 1 }
  }
  return out
}

/** Expenses by account for the window, largest first. */
export function expenseBreakdown(
  accounts: Account[],
  postings: Posting[],
  window: { start: string; end: string },
): ExpenseLine[] {
  const byId = new Map(accounts.map(a => [a.id, a]))
  const totals = new Map<string, number>()
  for (const p of postings) {
    const date = p.entryDate
    if (!date || date < window.start || date > window.end) continue
    const a = byId.get(p.accountId)
    if (a?.type !== 'expense') continue
    totals.set(a.id, roundCents((totals.get(a.id) ?? 0) + p.amount))
  }
  const total = roundCents(Array.from(totals.values()).reduce((s, v) => s + v, 0))
  return Array.from(totals.entries())
    .map(([id, amount]) => {
      const a = byId.get(id)!
      return { code: a.code, name: a.name, amount, share: total === 0 ? null : amount / total }
    })
    // A contra or reversing entry can leave an account at exactly zero for the window; showing it
    // as a 0% line is noise, and hiding it loses nothing — the trial balance still carries it.
    .filter(l => l.amount !== 0)
    .sort((a, b) => b.amount - a.amount)
}

/**
 * Average monthly cash burn: expenses less the non-cash ones, over the months the window covers.
 *
 * Null below two months of window, because one month is not an average and presenting it as one
 * turns a single quarterly insurance premium into a runway forecast.
 */
export function monthlyBurn(
  accounts: Account[],
  postings: Posting[],
  window: { start: string; end: string },
): number | null {
  const months = monthsBetween(window.start, window.end)
  if (months < 2) return null
  const bySubtype = new Map(accounts.map(a => [a.id, { type: a.type, subtype: a.subtype ?? null }]))
  let cash = 0
  for (const p of postings) {
    const date = p.entryDate
    if (!date || date < window.start || date > window.end) continue
    const a = bySubtype.get(p.accountId)
    if (a?.type !== 'expense') continue
    if (a.subtype && NON_CASH_EXPENSE_SUBTYPES.has(a.subtype)) continue
    cash = roundCents(cash + p.amount)
  }
  return cash <= 0 ? null : roundCents(cash / months)
}

function monthsBetween(start: string, end: string): number {
  const sy = Number(start.slice(0, 4)); const sm = Number(start.slice(5, 7))
  const ey = Number(end.slice(0, 4)); const em = Number(end.slice(5, 7))
  return (ey - sy) * 12 + (em - sm) + 1
}

/**
 * The management company's dashboard, for one vehicle over one window.
 *
 * `window.end` bounds the P&L; the CASH balance is cumulative to that date rather than confined to
 * the window, because "cash in the window" is not a thing anybody wants to know — the balance is.
 */
export async function loadMancoOverview(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  window: { start: string; end: string },
): Promise<MancoOverview> {
  const { accounts, postings } = await loadPostedLedger(admin, fundId, group, window.end)

  const cashAccounts = accounts.filter(a => a.type === 'asset' && a.subtype === CASH_SUBTYPE)
  const cashIds = new Set(cashAccounts.map(a => a.id))
  const cashBalance = new Map<string, number>()
  for (const p of postings) {
    if (!cashIds.has(p.accountId)) continue
    if (p.entryDate && p.entryDate > window.end) continue
    cashBalance.set(p.accountId, roundCents((cashBalance.get(p.accountId) ?? 0) + p.amount))
  }

  const quarters = quarterCycles(accounts, postings, window)
  const revenue = roundCents(quarters.reduce((s, q) => s + q.revenue, 0))
  const expenses = roundCents(quarters.reduce((s, q) => s + q.expenses, 0))
  const cash = roundCents(Array.from(cashBalance.values()).reduce((s, v) => s + v, 0))
  const burn = monthlyBurn(accounts, postings, window)

  return {
    vehicle: group,
    cash,
    cashAccounts: cashAccounts
      .map(a => ({ code: a.code, name: a.name, balance: cashBalance.get(a.id) ?? 0 }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    revenue,
    expenses,
    net: roundCents(revenue - expenses),
    quarters,
    expenseLines: expenseBreakdown(accounts, postings, window),
    monthlyBurn: burn,
    // Runway is only meaningful while the firm is burning. A profitable manco gets null and the UI
    // says so, rather than a number that grows to infinity as burn approaches zero.
    runwayMonths: burn && burn > 0 ? Math.round((cash / burn) * 10) / 10 : null,
    hasLedger: postings.length > 0,
  }
}
