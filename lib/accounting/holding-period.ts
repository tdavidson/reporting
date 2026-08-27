// Short-term or long-term: which K-1 box a realized gain lands in.
//
// The ledger records realized gain as one number (account 4000). The K-1 needs it split between
// box 8 and box 9a, and the split is not a property of the sale — it is a property of each LOT
// the sale consumed. Selling 1,000 units that were bought across three rounds can produce gain on
// both sides of the line from a single disposal, and reporting it all as long-term because the
// position is old is exactly the kind of plausible answer that is wrong.
//
// So the split follows lib/portfolio/lots.ts, which already walks disposals in date order and
// records which lots each one consumed, with their dates.

import { roundCents } from './ledger'
import type { DisposalBasis } from '@/lib/portfolio/lots'

/**
 * More than one year, counting from the day AFTER acquisition.
 *
 * §1223: the holding period starts the day after the property is acquired, and "more than one
 * year" means the anniversary itself is still SHORT-term. Property bought 15 Jan 2025 and sold
 * 15 Jan 2026 is short-term; sold 16 Jan 2026 it is long-term. The off-by-one is the entire rule,
 * which is why it gets its own function and its own tests.
 */
export function isLongTerm(acquired: string, disposed: string): boolean {
  if (!acquired || !disposed) return false
  const a = new Date(`${acquired}T00:00:00Z`)
  const d = new Date(`${disposed}T00:00:00Z`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(d.getTime())) return false

  // The first day that qualifies is the day after the one-year anniversary of acquisition.
  const anniversary = new Date(a)
  anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1)
  return d.getTime() > anniversary.getTime()
}

export interface GainSplit {
  shortTerm: number
  longTerm: number
  /**
   * Gain that could not be classified.
   *
   * Two causes, both real: a fund on AVERAGE cost has no lots to point at, and a disposal can
   * claim more units than any lot supplies. Neither is corrected here — an unclassified gain
   * reported as long-term would be a guess in the taxpayer's favour, made silently.
   */
  undetermined: number
}

export const NO_GAIN: GainSplit = { shortTerm: 0, longTerm: 0, undetermined: 0 }

export interface DisposalGain {
  /** The disposal, with the lots it consumed (from `disposalBasis`). */
  basis: DisposalBasis
  /** Proceeds recognised on this disposal — cash plus escrow, as the tracker counts them. */
  proceeds: number
}

/**
 * Split one disposal's gain across the holding periods of the lots it consumed.
 *
 * Gain is apportioned by each lot's share of the basis consumed, because that is the share of the
 * position each lot represented. Where the method left no allocations (average cost), or the
 * disposal drew on units no lot supplied, the corresponding gain is `undetermined` rather than
 * assigned.
 */
export function splitDisposalGain(d: DisposalGain): GainSplit {
  const totalGain = roundCents(d.proceeds - (d.basis.recordedBasis ?? d.basis.computedBasis))
  if (totalGain === 0) return NO_GAIN

  const allocations = d.basis.allocations ?? []
  const allocatedBasis = allocations.reduce((s, a) => s + a.cost, 0)

  // No lots to point at — average cost, or a disposal with no matched units at all.
  if (allocations.length === 0 || allocatedBasis === 0) {
    return { shortTerm: 0, longTerm: 0, undetermined: totalGain }
  }

  let shortTerm = 0
  let longTerm = 0
  let assigned = 0
  allocations.forEach((a, i) => {
    // The last allocation absorbs the rounding remainder, so the parts tie to the whole.
    const share =
      i === allocations.length - 1
        ? roundCents(totalGain - assigned)
        : roundCents((totalGain * a.cost) / allocatedBasis)
    assigned = roundCents(assigned + share)
    if (isLongTerm(a.lotDate, d.basis.date)) longTerm = roundCents(longTerm + share)
    else shortTerm = roundCents(shortTerm + share)
  })

  // Units the disposal claimed that no lot supplied carry gain nobody can classify. Their share
  // is already inside the numbers above only if they had basis; when they had none, the gain sits
  // with the matched lots and `unmatchedUnits` is the caller's signal that the position is short.
  return { shortTerm, longTerm, undetermined: 0 }
}

/** Sum a year's disposals into one split. */
export function splitGains(disposals: DisposalGain[]): GainSplit {
  return disposals.reduce<GainSplit>((acc, d) => {
    const s = splitDisposalGain(d)
    return {
      shortTerm: roundCents(acc.shortTerm + s.shortTerm),
      longTerm: roundCents(acc.longTerm + s.longTerm),
      undetermined: roundCents(acc.undetermined + s.undetermined),
    }
  }, NO_GAIN)
}

export function totalGain(s: GainSplit): number {
  return roundCents(s.shortTerm + s.longTerm + s.undetermined)
}
