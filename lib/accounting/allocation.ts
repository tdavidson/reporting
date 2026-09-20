// Allocation engine: turn a fund-level amount into per-LP shares.
//
// The first pass is pure pro-rata by an ownership basis (commitments). The hard
// part is not the ratio — it's making the pennies sum EXACTLY to the fund total
// so the books tie out. We apportion in integer cents with the largest-remainder
// method, which distributes the leftover cents deterministically.

import { roundCents } from './ledger'

export interface LpOwnership {
  lpEntityId: string
  /** Basis for pro-rata allocation — typically committed capital. */
  commitment: number
}

/**
 * Split an integer number of cents across weights so the parts sum EXACTLY to
 * `totalCents`. Largest-remainder (Hamilton) method: floor each share, then hand
 * the remaining cents to the largest fractional remainders. Deterministic; ties
 * break toward the earlier index for stability across runs.
 */
export function apportionCents(totalCents: number, weights: number[]): number[] {
  const n = weights.length
  if (n === 0) return []
  const total = Math.round(totalCents)
  const sumW = weights.reduce((a, b) => a + b, 0)

  // Degenerate basis (all zero): spread evenly, largest-remainder on equal parts.
  const effective = sumW === 0 ? weights.map(() => 1) : weights
  const effSum = sumW === 0 ? n : sumW

  const exact = effective.map(w => (total * w) / effSum)
  const floors = exact.map(Math.floor)
  let remainder = total - floors.reduce((a, b) => a + b, 0)

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => (b.frac - a.frac) || (a.i - b.i))

  const result = floors.slice()
  for (let k = 0; k < order.length && remainder > 0; k++) {
    result[order[k].i] += 1
    remainder -= 1
  }
  // Handle negative totals symmetrically (e.g. a credit allocation).
  for (let k = 0; k < order.length && remainder < 0; k++) {
    result[order[k].i] -= 1
    remainder += 1
  }
  return result
}

/**
 * Allocate a money amount (major units, e.g. dollars) across owners pro-rata by
 * commitment. Returns a map of lpEntityId → amount whose values sum exactly to
 * the input, to the cent.
 */
export function allocateAmount(total: number, owners: LpOwnership[]): Map<string, number> {
  const cents = Math.round(roundCents(total) * 100)
  const parts = apportionCents(cents, owners.map(o => Math.max(0, o.commitment)))
  const out = new Map<string, number>()
  owners.forEach((o, i) => out.set(o.lpEntityId, parts[i] / 100))
  return out
}

export interface CumulativeAllocationLine {
  lpEntityId: string
  /** This allocation's exact pro-rata entitlement, before cent rounding. */
  exactAmount: number
  /** The cent-denominated amount to post after applying prior rounding residuals. */
  amount: number
}

/**
 * Allocate one amount while carrying each owner's cumulative sub-cent residual forward.
 *
 * `residualByOwner` is cumulative exact entitlement less cumulative posted amount from CLOSED
 * prior periods. The current exact share is added to it before cents are apportioned. A recipient
 * set can change between periods (terms or eligibility); normalize the residuals of the current
 * set back to zero so an old residual belonging to a now-excluded owner cannot create or destroy
 * a cent in this allocation.
 */
export function allocateAmountCumulatively(
  total: number,
  owners: LpOwnership[],
  residualByOwner: Map<string, number>,
): CumulativeAllocationLine[] {
  if (owners.length === 0) return []
  const roundedTotal = roundCents(total)
  const weights = owners.map(owner => Math.max(0, owner.commitment))
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0)
  const effectiveWeights = weightTotal === 0 ? weights.map(() => 1) : weights
  const effectiveTotal = weightTotal === 0 ? owners.length : weightTotal
  const exact = effectiveWeights.map(weight => (roundedTotal * weight) / effectiveTotal)
  const residuals = owners.map(owner => residualByOwner.get(owner.lpEntityId) ?? 0)
  const residualDrift = residuals.reduce((sum, residual) => sum + residual, 0)
  const adjustedExactCents = exact.map((amount, index) => (
    amount + residuals[index] - residualDrift * (effectiveWeights[index] / effectiveTotal)
  ) * 100)

  const floors = adjustedExactCents.map(Math.floor)
  let remainder = Math.round(roundedTotal * 100) - floors.reduce((sum, amount) => sum + amount, 0)
  const order = adjustedExactCents
    .map((amount, index) => ({ index, fraction: amount - Math.floor(amount) }))
    .sort((left, right) => (right.fraction - left.fraction) || (left.index - right.index))
  const cents = floors.slice()
  for (let index = 0; index < order.length && remainder > 0; index += 1) {
    cents[order[index].index] += 1
    remainder -= 1
  }
  for (let index = 0; index < order.length && remainder < 0; index += 1) {
    cents[order[index].index] -= 1
    remainder += 1
  }

  return owners.map((owner, index) => ({
    lpEntityId: owner.lpEntityId,
    exactAmount: exact[index],
    amount: cents[index] / 100,
  }))
}

/** Ownership fraction (0..1) per entity by commitment; sums to 1 (or 0 if no basis). */
export function ownershipFractions(owners: LpOwnership[]): Map<string, number> {
  const sum = owners.reduce((a, o) => a + Math.max(0, o.commitment), 0)
  const out = new Map<string, number>()
  for (const o of owners) out.set(o.lpEntityId, sum === 0 ? 0 : Math.max(0, o.commitment) / sum)
  return out
}
