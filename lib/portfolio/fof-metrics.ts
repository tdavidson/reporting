import { xirr, type CashFlow } from '@/lib/xirr'

/**
 * Every fund-of-funds quantity, derived. Pure — no Supabase import — so the whole quarterly
 * picture can be exercised in tests with no database.
 *
 * THE CENTRAL PROBLEM this module solves is the reporting lag. Underlying managers strike NAV
 * 45-90 days after quarter end, so at any reporting date the newest statement on hand is
 * usually a quarter stale. Carrying value is therefore the last reported NAV rolled forward
 * for OUR OWN cash flows since that NAV's as-of date:
 *
 *     carrying = reportedNav + calls since asOf - distributions since asOf
 *
 * Nothing here is stored. A stored carrying value drifts the moment a call notice arrives late,
 * which is the normal case rather than the exception.
 */

export type NavBasis = 'final' | 'preliminary' | 'estimate'

export interface FundHoldingTerms {
  companyId: string
  name: string
  managerName: string | null
  vintageYear: number | null
  strategy: string | null
  /** What we committed. Magnitude. */
  commitment: number
}

export interface FundCapitalEvent {
  companyId: string
  kind: 'call' | 'distribution'
  eventDate: string
  /** Magnitude — `kind` carries the direction. */
  amount: number
  /** Distributions only: the portion that restores unfunded commitment. */
  recallableAmount: number
  charReturnOfCapital: number
  charRealizedGain: number
  charIncome: number
}

export interface FundNavStatement {
  companyId: string
  /** The manager's valuation date — NOT when the statement arrived. */
  asOfDate: string
  reportedNav: number
  basis: NavBasis
}

export interface FundPosition {
  companyId: string
  name: string
  managerName: string | null
  vintageYear: number | null
  strategy: string | null

  commitment: number
  contributed: number
  distributed: number
  recallableReturned: number
  unfunded: number
  /** null when commitment is 0 — never NaN. */
  pctCalled: number | null

  /** null when no manager statement has been received yet. */
  reportedNav: number | null
  navAsOf: string | null
  navBasis: NavBasis | null
  /** Days between the NAV's as-of date and the reporting date. null with no statement. */
  stalenessDays: number | null
  /** The roll-forward. Always a number — see the no-statement branch below. */
  carryingValue: number

  /** All null when contributed is 0 — no denominator. */
  dpi: number | null
  rvpi: number | null
  tvpi: number | null
  netIrr: number | null
}

const DAY_MS = 86_400_000
const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)

export function computeFundPositions(input: {
  terms: FundHoldingTerms[]
  events: FundCapitalEvent[]
  navs: FundNavStatement[]
  /** The reporting date. Nothing dated after it is visible. */
  asOf: string
}): FundPosition[] {
  const { terms, events, navs, asOf } = input

  return terms.map(t => {
    const mine = events
      .filter(e => e.companyId === t.companyId && e.eventDate <= asOf)
      .sort((a, b) => a.eventDate.localeCompare(b.eventDate))

    const calls = mine.filter(e => e.kind === 'call')
    const dists = mine.filter(e => e.kind === 'distribution')

    const contributed = sum(calls.map(e => e.amount))
    const distributed = sum(dists.map(e => e.amount))
    const recallableReturned = sum(dists.map(e => e.recallableAmount))

    // Recallable capital goes back on the hook — it restores callable commitment.
    const unfunded = t.commitment - contributed + recallableReturned
    const pctCalled = t.commitment > 0 ? contributed / t.commitment : null

    // The newest statement struck ON OR BEFORE the reporting date. A statement with a later
    // as-of date exists in the table (it arrived) but describes a future we cannot report.
    const stmt = navs
      .filter(n => n.companyId === t.companyId && n.asOfDate <= asOf)
      .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate))
      .at(-1) ?? null

    let carryingValue: number
    if (stmt) {
      const after = mine.filter(e => e.eventDate > stmt.asOfDate)
      carryingValue =
        stmt.reportedNav
        + sum(after.filter(e => e.kind === 'call').map(e => e.amount))
        - sum(after.filter(e => e.kind === 'distribution').map(e => e.amount))
    } else {
      // No statement has ever arrived. Contributed less distributed — i.e. cost — is the only
      // defensible figure; 0 would report a total loss on a fund that has merely not reported.
      carryingValue = contributed - distributed
    }

    const dpi = contributed > 0 ? distributed / contributed : null
    const rvpi = contributed > 0 ? carryingValue / contributed : null
    const tvpi = contributed > 0 ? (distributed + carryingValue) / contributed : null

    // Calls are money out (negative), distributions money in, and the carrying value is the
    // terminal inflow — the standard since-inception net IRR for an unrealized position.
    const flows: CashFlow[] = [
      ...mine.map(e => ({
        date: new Date(`${e.eventDate}T00:00:00Z`),
        amount: e.kind === 'call' ? -e.amount : e.amount,
      })),
      ...(carryingValue !== 0 ? [{ date: new Date(`${asOf}T00:00:00Z`), amount: carryingValue }] : []),
    ]
    const netIrr = flows.length >= 2 ? xirr(flows) : null

    return {
      companyId: t.companyId,
      name: t.name,
      managerName: t.managerName,
      vintageYear: t.vintageYear,
      strategy: t.strategy,
      commitment: t.commitment,
      contributed,
      distributed,
      recallableReturned,
      unfunded,
      pctCalled,
      reportedNav: stmt?.reportedNav ?? null,
      navAsOf: stmt?.asOfDate ?? null,
      navBasis: stmt?.basis ?? null,
      stalenessDays: stmt ? days(stmt.asOfDate, asOf) : null,
      carryingValue,
      dpi,
      rvpi,
      tvpi,
      netIrr,
    }
  })
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
