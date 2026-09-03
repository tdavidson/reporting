// The character of a distribution: what the money was, on the way out.
//
// Three buckets, matching the receive side (`fund_capital_events`): return of capital, realized
// gain, income. Held on the distribution header because character is a property of where the
// money came from, not of who receives it — each partner's share of each bucket is their frozen
// line amount over the total.
//
// A distribution's K-1 income boxes do NOT come from here; income and gain reach a partner's K-1
// through the period close allocating them to capital accounts. What this feeds is the notice an
// LP is sent, the layered projection one vehicle up, and — with `kind` — box 19.

import { roundCents } from './ledger'

/** Schedule K-1 box 19: A cash and marketable securities, B property, C other. */
export type DistributionKind = 'cash' | 'in_kind' | 'other'

export const DISTRIBUTION_KINDS: DistributionKind[] = ['cash', 'in_kind', 'other']

export const K1_BOX_19_CODE: Record<DistributionKind, 'A' | 'B' | 'C'> = {
  cash: 'A',
  in_kind: 'B',
  other: 'C',
}

export function isDistributionKind(v: unknown): v is DistributionKind {
  return typeof v === 'string' && (DISTRIBUTION_KINDS as string[]).includes(v)
}

export interface DistributionCharacter {
  returnOfCapital: number
  realizedGain: number
  income: number
}

export const UNCHARACTERISED: DistributionCharacter = {
  returnOfCapital: 0,
  realizedGain: 0,
  income: 0,
}

export function characterTotal(c: DistributionCharacter): number {
  return roundCents(c.returnOfCapital + c.realizedGain + c.income)
}

/**
 * All three buckets zero.
 *
 * Distinct from "characterised as nothing", and the distinction matters: every distribution
 * declared before the character columns existed reads as uncharacterised, and a report should
 * say so rather than print three zeroes as though they were stated.
 */
export function isUncharacterised(c: DistributionCharacter): boolean {
  return characterTotal(c) === 0
}

export interface CharacterProblem {
  error: string
}

/**
 * Validate a split against the distribution's total.
 *
 * Refused at declaration rather than repaired afterwards: a split that does not sum to what the
 * partners were told they would receive is not a rounding question, it is two different claims
 * about the same wire. The one tolerance is a cent, because the buckets are entered by hand and
 * an exact-to-the-penny requirement on three typed numbers is a rejection nobody can act on.
 *
 * Returns null when valid.
 */
export function validateCharacter(
  c: DistributionCharacter,
  total: number,
): CharacterProblem | null {
  for (const [name, v] of [
    ['return of capital', c.returnOfCapital],
    ['realized gain', c.realizedGain],
    ['income', c.income],
  ] as const) {
    if (!Number.isFinite(v)) return { error: `Character: ${name} must be a number` }
    if (v < 0) return { error: `Character: ${name} cannot be negative` }
  }

  if (isUncharacterised(c)) return null // Declining to characterise is allowed.

  const sum = characterTotal(c)
  if (Math.abs(sum - roundCents(total)) > 0.01) {
    return {
      error:
        `Character splits to ${sum.toFixed(2)} but the distribution totals ${roundCents(total).toFixed(2)}. ` +
        'The three buckets must sum to the distribution, or all be zero to leave it uncharacterised.',
    }
  }
  return null
}

/**
 * One partner's share of each bucket, pro-rata to what they were declared.
 *
 * Derived rather than stored: the line amount is already frozen, so deriving each partner's
 * character from it means the two cannot disagree. An uncharacterised distribution yields an
 * uncharacterised share rather than zeroes that look stated.
 */
export function characterForLine(
  c: DistributionCharacter,
  lineAmount: number,
  total: number,
): DistributionCharacter {
  if (isUncharacterised(c) || total <= 0) return UNCHARACTERISED
  const share = lineAmount / total
  return {
    returnOfCapital: roundCents(c.returnOfCapital * share),
    realizedGain: roundCents(c.realizedGain * share),
    income: roundCents(c.income * share),
  }
}

/** Read a character off a `distributions` row, whatever its column nullability. */
export function characterFromRow(row: {
  char_return_of_capital?: number | string | null
  char_realized_gain?: number | string | null
  char_income?: number | string | null
}): DistributionCharacter {
  return {
    returnOfCapital: Number(row.char_return_of_capital ?? 0),
    realizedGain: Number(row.char_realized_gain ?? 0),
    income: Number(row.char_income ?? 0),
  }
}
