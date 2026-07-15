// Fund-level performance, DERIVED FROM THE LEDGER.
//
// This replaces the old Funds page, which computed its numbers client-side from
// `fund_cash_flows` — a table of hand-typed commitment / called / distribution rows — plus a
// hand-typed cash-on-hand figure, and then ESTIMATED carry with a heuristic:
//
//     estimatedCarry = carryRate × (grossAssets × (1 − gpCommitPct) − lpRemainingCapital)
//
// That heuristic existed because there was no way to know the real number. There is now. The
// close accrues carried interest at each period end on a hypothetical liquidation and books
// it as an equity reallocation between partners' capital accounts (close.ts accrueCarry).
// So an LP's capital account is ALREADY NET of the GP's share, and the fund's NAV is already
// carved up correctly between them. Nothing needs estimating.
//
// WHAT THIS MEANS FOR THE NUMBERS. Net-to-LP performance is now exact rather than
// approximated: it is simply the LP-class partners' own capital accounts. The GP's economics
// are the GP-class partners' accounts. They sum to the fund. There is no plug, no
// gpCommitPct, and no terminal-value-at-`new Date()` (the old IRR discounted future flows to
// today whatever date you asked for).
//
// DENOMINATOR: paid-in, which IS called capital — capital is recognised at the call, and may
// still be unfunded. Same convention as live-report.ts and the LP snapshot, so a fund-level
// TVPI and the LP-level TVPIs underneath it are computed the same way and can be reconciled.

import type { SupabaseClient } from '@supabase/supabase-js'
import { roundCents } from './ledger'
import { loadCapitalPostings } from './capital-source'
import { computeCapitalAccounts, bucketForSourceType, type CapitalAccount } from './capital-account'
import { loadCommitmentEvents, commitmentsAsOf } from './terms'
import { commitmentsFromPositions } from './lp-positions'
import { loadEntityNames, loadOwnership, listVehicles } from './load'
import { xirr, type CashFlow } from '@/lib/xirr'

export interface FundMetrics {
  committed: number
  /** Recognised capital. = called. May include unfunded calls. */
  paidIn: number
  /** Commitment not yet called. */
  uncalled: number
  distributions: number
  /** Remaining capital — the partners' ending balances. Already net of accrued carry. */
  nav: number
  totalValue: number
  dpi: number | null
  rvpi: number | null
  tvpi: number | null
  irr: number | null
}

export interface VehicleEconomics {
  vehicle: string
  /** The vehicle's vintage year, if recorded. Nothing derives this — it is stated. */
  vintageYear: number | null
  source: 'ledger' | 'events'
  lpCount: number
  /** Every partner. This is the fund. */
  fund: FundMetrics
  /** LP-class partners only — net-to-LP, exactly, with the GP's carry already removed. */
  lp: FundMetrics
  /** GP-class partners only. */
  gp: FundMetrics
  /** Carried interest accrued to the GP so far. A mark, not a debt — it reverses if NAV falls. */
  carryAccrued: number
}

const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null)

const EMPTY: FundMetrics = {
  committed: 0, paidIn: 0, uncalled: 0, distributions: 0, nav: 0, totalValue: 0,
  dpi: null, rvpi: null, tvpi: null, irr: null,
}

/**
 * Roll a set of capital accounts up into fund-level metrics.
 *
 * Pure, so the arithmetic can be pinned by a test. `accounts` is whichever slice you want:
 * every partner (the fund), the LP-class ones (net to LP), or the GP-class ones.
 */
export function rollUp(
  accounts: CapitalAccount[],
  committed: number,
  flows: CashFlow[],
  asOf: Date | null,
): FundMetrics {
  if (accounts.length === 0) return { ...EMPTY, committed: roundCents(committed) }

  const paidIn = roundCents(accounts.reduce((s, a) => s + a.contributions, 0))
  // Distributions are stored negative on a capital account (it is a credit balance).
  const distributions = roundCents(accounts.reduce((s, a) => s + -a.distributions, 0))
  const nav = roundCents(accounts.reduce((s, a) => s + a.ending, 0))
  const totalValue = roundCents(nav + distributions)

  // The terminal value is the remaining capital AT THE REPORTING DATE — not at `new Date()`,
  // which is what the old fund page used and which quietly discounted every future flow back
  // to today no matter which date you asked it about.
  const irrFlows = [...flows]
  if (asOf && Math.abs(nav) > 0.005) irrFlows.push({ date: asOf, amount: nav })

  return {
    committed: roundCents(committed),
    paidIn,
    uncalled: roundCents(committed - paidIn),
    distributions,
    nav,
    totalValue,
    dpi: ratio(distributions, paidIn),
    rvpi: ratio(nav, paidIn),
    tvpi: ratio(totalValue, paidIn),
    irr: irrFlows.length >= 2 ? xirr(irrFlows) : null,
  }
}

/**
 * One vehicle's economics, from its books.
 *
 * Works for a `capital_source = 'events'` vehicle too: it goes through `loadCapitalPostings`,
 * which is the seam that serves both producers. A vehicle with no capital data at all comes
 * back with zeroes rather than being omitted — a fund overview that silently drops a vehicle
 * is worse than one that shows it empty.
 */
export async function vehicleEconomics(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  asOf?: string,
): Promise<VehicleEconomics> {
  const [{ source, postings }, commitmentEvents, owners, names, classes, vintage] = await Promise.all([
    loadCapitalPostings(admin, fundId, group, asOf),
    loadCommitmentEvents(admin, fundId, group),
    loadOwnership(admin, fundId, group),
    loadEntityNames(admin, fundId, group),
    loadEntityClasses(admin, fundId),
    loadVintage(admin, fundId, group),
  ])

  const accounts = computeCapitalAccounts(postings)

  // Commitments. For a tracking vehicle, from its latest dated positions; otherwise from the
  // effective-dated commitment events, falling back to the legacy scalar.
  let commitmentByLp: Map<string, number>
  if (source !== 'ledger') {
    commitmentByLp = await commitmentsFromPositions(admin, fundId, group, asOf)
    if (!Array.from(commitmentByLp.values()).some(v => v > 0)) {
      commitmentByLp = new Map(owners.map(o => [o.lpEntityId, o.commitment]))
    }
  } else {
    commitmentByLp = commitmentsAsOf(commitmentEvents, asOf)
    if (!Array.from(commitmentByLp.values()).some(v => v > 0)) {
      commitmentByLp = new Map(owners.map(o => [o.lpEntityId, o.commitment]))
    }
  }

  const asOfDate = asOf ? new Date(asOf) : new Date()

  // The IRR terminal (when the NAV is valued) must be dated when the NAV was actually STATED.
  // A ledger vehicle's NAV persists to the report date, so asOf is right. A tracking vehicle's
  // NAV is stated as of its latest position date — using the report date instead spreads a large
  // TVPI over the months since and annualizes it to nonsense (a single cutover then has no time
  // spread and derives no IRR, which is the honest answer).
  const lastPostingDate = postings.reduce((m, p) => (p.entryDate && p.entryDate > m ? p.entryDate : m), '')
  const terminalDate = source === 'events' && lastPostingDate ? new Date(lastPostingDate) : asOfDate

  // Dated flows, from the LP's point of view: a contribution is money out (negative), a
  // distribution is money back (positive).
  const flowsFor = (ids: Set<string> | null): CashFlow[] => {
    const out: CashFlow[] = []
    for (const p of postings) {
      if (ids && (!p.lpEntityId || !ids.has(p.lpEntityId))) continue
      const bucket = bucketForSourceType(p.sourceType)
      if (bucket !== 'contributions' && bucket !== 'distributions') continue
      const delta = -p.amount // capital delta: credit positive
      if (Math.abs(delta) < 0.005) continue
      out.push({
        date: new Date(p.entryDate ?? asOfDate.toISOString().slice(0, 10)),
        // A contribution increases capital (delta > 0) and is money OUT for the partner.
        amount: -delta,
      })
    }
    return out
  }

  const ids = Array.from(accounts.keys())
  const lpIds = new Set(ids.filter(id => (classes.get(id) ?? 'lp') !== 'gp'))
  const gpIds = new Set(ids.filter(id => (classes.get(id) ?? 'lp') === 'gp'))

  const sumCommit = (set: Set<string> | null) =>
    Array.from(commitmentByLp.entries())
      .filter(([id]) => !set || set.has(id))
      .reduce((s, [, v]) => s + v, 0)

  const pick = (set: Set<string> | null) =>
    ids.filter(id => !set || set.has(id)).map(id => accounts.get(id)!)

  const carryAccrued = roundCents(
    Array.from(gpIds).reduce((s, id) => s + (accounts.get(id)?.carriedInterest ?? 0), 0)
  )

  return {
    vehicle: group,
    vintageYear: vintage,
    source,
    lpCount: lpIds.size,
    fund: rollUp(pick(null), sumCommit(null), flowsFor(null), terminalDate),
    lp: rollUp(pick(lpIds), sumCommit(lpIds), flowsFor(lpIds), terminalDate),
    gp: rollUp(pick(gpIds), sumCommit(gpIds), flowsFor(gpIds), terminalDate),
    carryAccrued,
  }
}

/** Every vehicle in the fund. */
export async function fundEconomics(
  admin: SupabaseClient,
  fundId: string,
  asOf?: string,
): Promise<VehicleEconomics[]> {
  const vehicles = await listVehicles(admin, fundId)
  const out: VehicleEconomics[] = []
  for (const v of vehicles) {
    out.push(await vehicleEconomics(admin, fundId, v, asOf))
  }
  return out.sort((a, b) => a.vehicle.localeCompare(b.vehicle))
}

/** partner_class per entity. */
async function loadEntityClasses(admin: SupabaseClient, fundId: string): Promise<Map<string, string>> {
  const { data } = await (admin as any)
    .from('lp_entities').select('id, partner_class').eq('fund_id', fundId)
  return new Map(((data as any[]) ?? []).map(e => [e.id as string, (e.partner_class ?? 'lp') as string]))
}

/** The vehicle's stated vintage year. */
async function loadVintage(admin: SupabaseClient, fundId: string, group: string): Promise<number | null> {
  const { data } = await (admin as any)
    .from('fund_vehicles').select('vintage_year').eq('fund_id', fundId).eq('name', group).maybeSingle()
  const y = (data as any)?.vintage_year
  return y == null ? null : Number(y)
}
