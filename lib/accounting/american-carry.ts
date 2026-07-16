// Deal-by-deal (American) carry on exits.
//
// Under an American waterfall the GP earns carry on each deal's OWN result as it realizes, rather
// than waiting for the whole fund to return its capital (European). Each deal must first clear its
// FULLY-LOADED cost — its own cost basis PLUS the fund expenses allocated to it (by capital share,
// per the user) — before the GP takes carryRate of the remaining gain. Winners are NOT taken in
// isolation forever: total carry over the fund's life still equals the European whole-fund result,
// because a clawback trues it up. This module computes the per-deal EARLY entitlement (what the GP
// can distribute now); the clawback (carry paid in excess of the whole-fund accrual) is the
// existing accrued-vs-paid surface on the GP panel.

import { roundCents } from './ledger'

export interface DealResult {
  companyId: string
  name: string
  /** Cost basis deployed into the deal (the portion being measured — realized + remaining). */
  costBasis: number
  /** Cash + escrow realized from the deal so far. */
  proceeds: number
  /** Fair value of any position still held (0 for a fully-exited deal). */
  remainingValue: number
}

export interface DealCarry extends DealResult {
  /** Fund expenses allocated to this deal, by cost share. */
  allocatedExpense: number
  /** costBasis + allocatedExpense — what the deal must return before carry. */
  fullyLoadedCost: number
  /** proceeds + remainingValue − fullyLoadedCost (may be negative). */
  profit: number
  /** carryRate × max(0, profit) — the GP's deal-by-deal entitlement. */
  carry: number
}

export interface DealByDealCarry {
  deals: DealCarry[]
  /** Σ of per-deal carry — the total American carry earned deal-by-deal to date. */
  totalCarry: number
  /** Total fund expenses spread across the deals. */
  totalExpenses: number
}

/**
 * Compute each deal's American carry entitlement. `totalExpenses` (fund expenses to allocate) is
 * spread across deals by cost share — a deal isn't truly in profit until it has also earned back
 * its slice of what the fund spent to hold the portfolio. Carry is taken on each deal's own gain
 * over its fully-loaded cost; losers contribute 0 (never negative), so the deal-by-deal total is
 * the GP's EARLY entitlement, before the whole-fund clawback reconciles it.
 */
export function dealByDealCarry(
  deals: DealResult[],
  opts: { carryRate: number; totalExpenses?: number },
): DealByDealCarry {
  const carryRate = opts.carryRate
  const totalExpenses = roundCents(opts.totalExpenses ?? 0)
  const totalCost = roundCents(deals.reduce((s, d) => s + Math.max(0, d.costBasis), 0))

  const out: DealCarry[] = deals.map(d => {
    const allocatedExpense = totalCost > 0 ? roundCents(totalExpenses * (Math.max(0, d.costBasis) / totalCost)) : 0
    const fullyLoadedCost = roundCents(d.costBasis + allocatedExpense)
    const profit = roundCents(d.proceeds + d.remainingValue - fullyLoadedCost)
    const carry = carryRate > 0 && profit > 0 ? roundCents(profit * carryRate) : 0
    return { ...d, allocatedExpense, fullyLoadedCost, profit, carry }
  })

  return {
    deals: out,
    totalCarry: roundCents(out.reduce((s, d) => s + d.carry, 0)),
    totalExpenses,
  }
}
