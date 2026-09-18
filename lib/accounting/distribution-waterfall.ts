// Splitting a distribution the way the LPA says to — through the waterfall, not pro-rata.
//
// THE BUG THIS REPLACES. Declaring a distribution split the total across every partner by capital
// balance, GP included. That is not a waterfall. Under a European waterfall the first dollar out
// returns LP capital, the next pays the preferred return, then the GP catches up, and only the
// remainder is split at the carry rate. Pro-rata by capital hands the GP a share of every dollar
// from the first one, sized by whatever carry the close happened to have accrued — a number that
// depends on when the last close ran, not on what the partners agreed.
//
// HOW IT WORKS. `runWaterfall` (waterfall.ts) is pure over a cumulative STATE — capital returned so
// far, preferred paid so far, carry paid so far. Nothing stores that state, and it should not be
// stored: it is a function of the distributions that came before. So we REPLAY them. Every prior
// distribution total, in date order, runs through the waterfall with the preferred return accrued
// to that date, and the state it leaves behind is where this distribution starts. Declaring twice
// on the same books gives the same split; a corrected prior distribution corrects every later one.
//
// The replay is over TOTALS, not over who received what. The LPA defines the tiers on cumulative
// amounts, so the tier state is what the agreement implies given the money that has left the fund,
// whether or not an earlier split honoured it. The gap between what the GP has actually been paid
// and what the replay says it should hold is surfaced as a warning, never silently corrected.
//
// CONSISTENCY WITH THE CLOSE. The close accrues carry on a hypothetical liquidation using the same
// `runWaterfall`, with the carry recipients excluded from the LP economics (they receive carry;
// they do not pay it). This split makes the same exclusion, so a distribution and the next close
// agree about what the GP is owed. A recipient entity that has ALSO contributed capital is
// therefore outside the waterfall here exactly as it is there — a warning says so, and the GP can
// edit the lines.

import { runWaterfall, type WaterfallState, type WaterfallTerms } from './waterfall'
import { preferredTarget, type DatedContribution, type VehicleCarryTerms } from './carry'
import { allocateAmount } from './allocation'
import { roundCents } from './ledger'

/** One partner's economics as at the distribution date, from the capital account. */
export interface PartnerEconomics {
  lpEntityId: string
  /** Cumulative capital contributed (positive). */
  contributed: number
  /** Cumulative distributions received (positive). */
  distributed: number
  /** Capital account balance today. */
  ending: number
}

/** A prior distribution — the fund-wide total that left on that date, carry included. */
export interface PriorDistribution {
  date: string
  amount: number
}

export type SplitMethod = 'waterfall' | 'pro_rata' | 'manual'

/** What each tier of THIS distribution took. */
export interface WaterfallTiers {
  returnOfCapital: number
  preferred: number
  catchUp: number
  /** The GP's share of the final split tier. */
  carry: number
  /** The LPs' share of the final split tier. */
  profitToLP: number
  toLP: number
  toGP: number
}

export interface DistributionSplit {
  method: SplitMethod
  /** LP lines — every partner outside the carry recipients, pro-rata within the LP tiers. */
  lines: { lpEntityId: string; amount: number }[]
  /** Carry lines — the GP's take, split across the recipients by their percentages. */
  carryLines: { lpEntityId: string; amount: number }[]
  tiers: WaterfallTiers
  stateBefore: WaterfallState
  stateAfter: WaterfallState
  warnings: string[]
}

export const ZERO_TIERS: WaterfallTiers = {
  returnOfCapital: 0, preferred: 0, catchUp: 0, carry: 0, profitToLP: 0, toLP: 0, toGP: 0,
}

function wfTerms(terms: VehicleCarryTerms): WaterfallTerms {
  // 'straight' is the waterfall with no hurdle: return of capital, then the split. Setting the
  // preferred target to zero makes the catch-up tier vanish on its own (there is nothing to catch
  // up to), which is exactly the straight definition.
  return { carryRate: terms.carryRate, catchUpRate: terms.kind === 'straight' ? 1 : terms.catchupRate }
}

function prefTarget(terms: VehicleCarryTerms, contributions: DatedContribution[], asOf: string): number {
  if (terms.kind === 'straight') return 0
  return preferredTarget(contributions, asOf, terms.prefRate, terms.prefCompounds)
}

/**
 * Replay every prior distribution through the waterfall to find where the tiers stand today.
 *
 * `contributedCapital` is the LPs' total contributed capital AS OF the replay date: contributions
 * dated after `asOf` are not yet capital to be returned. Each prior runs with the preferred return
 * accrued to ITS date, so a distribution made before the hurdle had accrued much correctly went
 * mostly to capital.
 */
export function replayWaterfallState(
  priors: PriorDistribution[],
  contributions: DatedContribution[],
  terms: VehicleCarryTerms,
  asOf: string,
): WaterfallState {
  const contributedAsOf = (date: string) =>
    roundCents(contributions.filter(c => c.date <= date && c.amount > 0).reduce((s, c) => s + c.amount, 0))

  let state: WaterfallState = {
    contributedCapital: 0,
    returnedCapital: 0,
    preferredPaid: 0,
    preferredTarget: 0,
    gpCarryPaid: 0,
  }
  const sorted = [...priors].filter(p => p.amount > 0 && p.date <= asOf).sort((a, b) => a.date.localeCompare(b.date))
  for (const p of sorted) {
    state = {
      ...state,
      contributedCapital: contributedAsOf(p.date),
      preferredTarget: prefTarget(terms, contributions, p.date),
    }
    state = runWaterfall(p.amount, wfTerms(terms), state).state
  }
  return {
    ...state,
    contributedCapital: contributedAsOf(asOf),
    preferredTarget: prefTarget(terms, contributions, asOf),
  }
}

/** Pro-rata across a basis, falling back to equal shares when the basis is empty. */
function share(total: number, basis: { lpEntityId: string; weight: number }[]): { lpEntityId: string; amount: number }[] {
  if (basis.length === 0 || total <= 0) return []
  const positive = basis.filter(b => b.weight > 0)
  const use = positive.length > 0 ? positive : basis.map(b => ({ ...b, weight: 1 }))
  return Array.from(allocateAmount(total, use.map(b => ({ lpEntityId: b.lpEntityId, commitment: b.weight }))).entries())
    .map(([lpEntityId, amount]) => ({ lpEntityId, amount }))
    .filter(l => l.amount > 0)
}

export interface SplitInput {
  total: number
  terms: VehicleCarryTerms
  /** Every partner with a capital account, recipients included — they are separated here. */
  partners: PartnerEconomics[]
  /** Dated LP contributions, for the hurdle. Recipients' contributions excluded, as in the close. */
  contributions: DatedContribution[]
  priors: PriorDistribution[]
  /** The distribution date — the hurdle accrues to here. */
  asOf: string
  /** The GP's carry actually paid to date, for the reconciliation warning. Optional. */
  carryPaidToDate?: number
}

/**
 * Split a distribution total into LP lines and carry lines.
 *
 * With no carry terms this degrades to the old behaviour — pro-rata by capital balance across
 * every partner, method 'pro_rata' — so a vehicle that never set terms is unchanged.
 */
export function splitDistribution(input: SplitInput): DistributionSplit {
  const total = roundCents(input.total)
  const { terms } = input
  const warnings: string[] = []

  const recipientIds = new Set(terms.recipients.map(r => r.lpEntityId))
  const noCarry = terms.kind === 'none' || terms.carryRate <= 0 || terms.recipients.length === 0

  if (noCarry) {
    if (terms.kind !== 'none' && terms.carryRate > 0 && terms.recipients.length === 0) {
      warnings.push('Carry terms are set but no recipient is named, so the distribution is split pro-rata by capital balance with no carry.')
    }
    const lines = share(total, input.partners.map(p => ({ lpEntityId: p.lpEntityId, weight: Math.max(0, p.ending) })))
    const empty: WaterfallState = { contributedCapital: 0, returnedCapital: 0, preferredPaid: 0, preferredTarget: 0, gpCarryPaid: 0 }
    return {
      method: 'pro_rata',
      lines,
      carryLines: [],
      tiers: { ...ZERO_TIERS, toLP: total },
      stateBefore: empty,
      stateAfter: empty,
      warnings,
    }
  }

  const lps = input.partners.filter(p => !recipientIds.has(p.lpEntityId))
  for (const p of input.partners) {
    if (recipientIds.has(p.lpEntityId) && p.contributed > 0) {
      warnings.push(`${p.lpEntityId} receives the carry and has also contributed capital; the waterfall treats it as a carry recipient only, as the close does. Edit its line if it should share pro-rata.`)
    }
  }

  const stateBefore = replayWaterfallState(input.priors, input.contributions, terms, input.asOf)
  const result = runWaterfall(total, wfTerms(terms), stateBefore)

  const tiers: WaterfallTiers = {
    returnOfCapital: result.toReturnOfCapital,
    preferred: result.toPreferred,
    catchUp: result.toCatchUp,
    carry: result.toCarryGP,
    profitToLP: result.toCarryLP,
    toLP: result.toLP,
    toGP: result.toGP,
  }

  // LP tiers: capital comes back in proportion to what each partner put in; the preferred return
  // and the profit share follow the same basis, because both are earned on contributed capital.
  // A partner with no contributions (a transferee whose capital arrived as a transfer) falls back
  // to capital balance so they are not skipped.
  const basisContributed = lps.map(p => ({ lpEntityId: p.lpEntityId, weight: Math.max(0, p.contributed) }))
  const basis = basisContributed.some(b => b.weight > 0)
    ? basisContributed
    : lps.map(p => ({ lpEntityId: p.lpEntityId, weight: Math.max(0, p.ending) }))
  const lines = share(tiers.toLP, basis)

  // The GP's take, split across the recipients by percentage; the last absorbs the rounding
  // cent so the carry lines always tie to `toGP`.
  const carryLines: { lpEntityId: string; amount: number }[] = []
  if (tiers.toGP > 0) {
    let allocated = 0
    terms.recipients.forEach((r, i) => {
      const amt = i === terms.recipients.length - 1
        ? roundCents(tiers.toGP - allocated)
        : roundCents((tiers.toGP * r.pct) / 100)
      allocated = roundCents(allocated + amt)
      if (amt > 0) carryLines.push({ lpEntityId: r.lpEntityId, amount: amt })
    })
  }

  if (input.carryPaidToDate != null && Math.abs(input.carryPaidToDate - stateBefore.gpCarryPaid) > 0.01) {
    warnings.push(
      `The waterfall implies ${stateBefore.gpCarryPaid.toFixed(2)} of carry paid to date from prior distributions, ` +
      `but the books show ${input.carryPaidToDate.toFixed(2)}. Earlier distributions were split differently; review before declaring.`,
    )
  }

  return {
    method: 'waterfall',
    lines,
    carryLines,
    tiers,
    stateBefore,
    stateAfter: result.state,
    warnings,
  }
}

/**
 * The tax character the waterfall suggests: what came back as capital is return of capital, and
 * everything else is gain. Income cannot be told apart here — the close knows what the fund
 * earned, a distribution only knows what it paid — so it is left for the GP to move.
 */
export function suggestedCharacter(tiers: WaterfallTiers, total: number): { returnOfCapital: number; realizedGain: number; income: number } {
  const roc = roundCents(Math.min(tiers.returnOfCapital, total))
  return { returnOfCapital: roc, realizedGain: roundCents(total - roc), income: 0 }
}
