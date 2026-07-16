// Accrued carried interest.
//
// THE IDEA. At each close, ask: "if the fund liquidated at today's NAV, what would the GP be
// entitled to?" That number is the TARGET accrual. Compare it to what has already been accrued,
// and post the difference. Because the target is recomputed from scratch every period, the
// accrual reverses on its own when NAV falls — no special case, no clawback logic.
//
// This is the hypothetical-liquidation method, and it is what ASC 946 expects. Without it every
// LP's NAV overstates what they would actually receive by the GP's share of the unrealized
// gain.
//
// IT IS AN EQUITY REALLOCATION, NOT AN EXPENSE. Dr each LP's capital, Cr the GP's capital.
// It never touches P&L and never touches cash — which is precisely why the close has to do it
// AFTER every other category has landed: carry is computed on the NAV that those allocations
// produce.

import type { SupabaseClient } from '@supabase/supabase-js'
import { runWaterfall, type WaterfallTerms } from './waterfall'
import { roundCents } from './ledger'
import { vehicleIdByName } from './vehicle-id'

export type CarryKind = 'none' | 'straight' | 'american' | 'european'

export interface VehicleCarryTerms {
  kind: CarryKind
  carryRate: number
  prefRate: number
  catchupRate: number
  prefCompounds: boolean
  gpEntityId: string | null
}

export const NO_CARRY: VehicleCarryTerms = {
  kind: 'none',
  carryRate: 0,
  prefRate: 0,
  catchupRate: 1,
  prefCompounds: true,
  gpEntityId: null,
}

/** One LP's economics, as at the accrual date. All from the ledger. */
export interface LpEconomics {
  lpEntityId: string
  /** Cumulative capital contributed (positive). */
  contributed: number
  /** Cumulative distributions received (positive). */
  distributed: number
  /** Current capital account balance, BEFORE this period's carry accrual. */
  nav: number
}

/** A dated contribution, for accruing the preferred return. */
export interface DatedContribution {
  date: string
  amount: number
}

/**
 * The preferred return owed to LPs as at `asOf`.
 *
 * The hurdle accrues on each contribution from the day it was made — money committed on paper
 * earns nothing; money actually WIRED does. The ledger has these dates, so we use them rather
 * than approximating from a fund vintage.
 */
export function preferredTarget(
  contributions: DatedContribution[],
  asOf: string,
  rate: number,
  compounds: boolean
): number {
  if (rate <= 0) return 0

  const end = Date.parse(asOf)
  if (Number.isNaN(end)) return 0

  let total = 0
  for (const c of contributions) {
    const start = Date.parse(c.date)
    if (Number.isNaN(start) || start >= end || c.amount <= 0) continue
    // ACTUAL/365, the usual convention in an LPA. Using 365.25 would make "one year" 0.9993 of
    // a year and quietly understate the hurdle — small, but it compounds, and it is the kind of
    // difference an LP's accountant will find.
    const years = (end - start) / (365 * 24 * 60 * 60 * 1000)
    total += compounds
      ? c.amount * (Math.pow(1 + rate, years) - 1)
      : c.amount * rate * years
  }
  return roundCents(total)
}

export interface CarryTargetInput {
  lps: LpEconomics[]
  /** Dated LP contributions, for the preferred-return accrual. European/American. */
  contributions?: DatedContribution[]
  /** The date the accrual is measured at. European/American. */
  asOf?: string
}

/**
 * The GP's TOTAL carry entitlement if the fund liquidated at today's NAV.
 *
 * Not the amount to post — that is this minus whatever is already accrued. See `carryAccrual`.
 */
export function carryTarget(input: CarryTargetInput, terms: VehicleCarryTerms): number {
  if (terms.kind === 'none' || terms.carryRate <= 0) return 0

  const contributed = roundCents(input.lps.reduce((s, l) => s + l.contributed, 0))
  const distributed = roundCents(input.lps.reduce((s, l) => s + l.distributed, 0))
  const nav = roundCents(input.lps.reduce((s, l) => s + l.nav, 0))

  // What the LPs would hold in total if we sold everything today.
  const liquidation = roundCents(nav + distributed)

  if (terms.kind === 'straight') {
    // Profit over contributed capital, GP takes its rate. No pref, no catch-up.
    const profit = roundCents(liquidation - contributed)
    if (profit <= 0) return 0
    return roundCents(profit * terms.carryRate)
  }

  // European (whole-fund) AND American (deal-by-deal) accrue the SAME target here.
  //
  // American doesn't earn the GP MORE carry than European — it earns the same total, just PAID
  // earlier (as individual deals realize), with a clawback that pulls back any carry later deals
  // prove was overpaid. Since this close accrues carry as-if-liquidated-at-today's-NAV — i.e. the
  // GP's ULTIMATE entitlement — and the clawback makes that ultimate total identical to European,
  // the prudent accrued MARK is the whole-fund result for both. (Accruing a deal-by-deal "winners
  // only" figure would overstate the GP and understate LP NAV.) The genuine American difference —
  // distributing realized carry cash per deal before the whole fund is made whole — is a
  // distribution-timing concern, not an accrual one, and lives outside this mark. Run the real
  // waterfall on the hypothetical liquidation proceeds.
  const pref = preferredTarget(
    input.contributions ?? [],
    input.asOf ?? new Date(0).toISOString().slice(0, 10),
    terms.prefRate,
    terms.prefCompounds
  )

  const wfTerms: WaterfallTerms = { carryRate: terms.carryRate, catchUpRate: terms.catchupRate }
  const result = runWaterfall(liquidation, wfTerms, {
    contributedCapital: contributed,
    returnedCapital: 0,
    preferredPaid: 0,
    preferredTarget: pref,
    gpCarryPaid: 0,
  })

  // Everything the GP takes across the catch-up and carry tiers.
  return roundCents(result.toCatchUp + result.toCarryGP)
}

/** A vehicle's carry terms. Absent row = no carry, which is the only safe default:
 *  accruing carry nobody agreed to is worse than accruing none. */
export async function loadCarryTerms(
  admin: SupabaseClient,
  fundId: string,
  group: string
): Promise<VehicleCarryTerms> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) return NO_CARRY

  const { data } = await admin
    .from('vehicle_waterfall_terms' as any)
    .select('kind, carry_rate, pref_rate, catchup_rate, pref_compounds, gp_entity_id')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .maybeSingle()

  if (!data) return NO_CARRY
  const d = data as any
  const kind: CarryKind =
    d.kind === 'straight' || d.kind === 'american' || d.kind === 'european' ? d.kind : 'none'

  return {
    kind,
    carryRate: Number(d.carry_rate ?? 0),
    prefRate: Number(d.pref_rate ?? 0),
    catchupRate: Number(d.catchup_rate ?? 1),
    prefCompounds: d.pref_compounds !== false,
    gpEntityId: d.gp_entity_id ?? null,
  }
}

export interface CarryAccrual {
  /** Total entitlement at today's NAV. */
  target: number
  /** What is already sitting in the GP's carriedInterest bucket. */
  alreadyAccrued: number
  /** What to post. Negative = a reversal, because NAV fell. */
  delta: number
  /** Per-LP debit. Positive reduces that LP's capital. Sums to `delta`. */
  perLp: Map<string, number>
}

/**
 * What this period's close should post.
 *
 * The debit is shared across LPs in proportion to each one's PROFIT — carry is a share of
 * gains, so an LP sitting on a loss does not pay it, and an LP with twice the gain pays twice
 * as much. When the accrual REVERSES (NAV fell), the reversal is shared the same way, so it
 * unwinds along the path it was built.
 *
 * If nobody is in profit there is nothing to take carry from, and the target is zero anyway.
 */
export function carryAccrual(
  input: CarryTargetInput,
  terms: VehicleCarryTerms,
  alreadyAccrued: number
): CarryAccrual {
  const target = carryTarget(input, terms)
  const delta = roundCents(target - alreadyAccrued)
  const perLp = new Map<string, number>()

  if (delta === 0) return { target, alreadyAccrued, delta: 0, perLp }

  // Each LP's gain, measured the same way the target was: value today plus what they've taken
  // out, less what they put in.
  const profits = input.lps
    .map(l => ({ lpEntityId: l.lpEntityId, profit: roundCents(l.nav + l.distributed - l.contributed) }))
    .filter(p => p.profit > 0)

  const totalProfit = roundCents(profits.reduce((s, p) => s + p.profit, 0))
  if (totalProfit <= 0) {
    // No one is in profit. A positive target can't be sourced from anybody; a reversal has
    // nothing left to reverse against.
    return { target, alreadyAccrued, delta: 0, perLp }
  }

  // Largest-remainder, so the per-LP debits sum EXACTLY to delta and no cent is invented.
  let allocated = 0
  const shares = profits.map(p => ({ ...p, exact: (delta * p.profit) / totalProfit }))
  const rounded = shares.map(s => ({ ...s, amount: roundCents(s.exact) }))
  allocated = roundCents(rounded.reduce((s, r) => s + r.amount, 0))

  const drift = roundCents(delta - allocated)
  if (drift !== 0 && rounded.length > 0) {
    // Put the odd cent on the largest share — the conventional tiebreak.
    const biggest = rounded.reduce((a, b) => (Math.abs(b.exact) > Math.abs(a.exact) ? b : a))
    biggest.amount = roundCents(biggest.amount + drift)
  }

  for (const r of rounded) {
    if (r.amount !== 0) perLp.set(r.lpEntityId, r.amount)
  }

  return { target, alreadyAccrued, delta, perLp }
}
