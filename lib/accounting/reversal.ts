// Reversing a posted entry. Pure.
//
// A reversal is the correction a ledger keeps: the original stays posted, a dated contra-entry
// negates every posting, and the pair nets to zero from the reversal date on. A void makes the
// original vanish, which is fine for a draft and wrong for anything a statement was struck on —
// the preparer wants to see both the mistake and its fix, on the dates they happened.

import type { JournalEntry, Posting } from './types'
import { roundCents } from './ledger'

export const REVERSAL_REF_PREFIX = 'reversal:'

export const reversalRef = (originalId: string) => `${REVERSAL_REF_PREFIX}${originalId}`

/** The id an entry reverses, read off its source_ref — or null for an ordinary entry. */
export function reversedEntryId(sourceRef: string | null | undefined): string | null {
  return sourceRef && sourceRef.startsWith(REVERSAL_REF_PREFIX) ? sourceRef.slice(REVERSAL_REF_PREFIX.length) : null
}

/**
 * Why a reversal date is not allowed, or null when it is. A reversal before the original would
 * reverse something that had not happened yet; the same day is allowed, for the mistake caught
 * before close of business.
 */
export function reversalDateError(originalDate: string, reverseDate: string | null | undefined): string | null {
  if (!reverseDate || !/^\d{4}-\d{2}-\d{2}$/.test(reverseDate)) return 'A reversal date (YYYY-MM-DD) is required'
  if (reverseDate < originalDate) return `The reversal cannot be dated before the entry it reverses (${originalDate})`
  return null
}

export interface ReversibleEntry {
  id: string
  fundId: string
  entryDate: string
  memo?: string | null
  sourceType?: string | null
  reference?: string | null
  postings: Posting[]
}

/**
 * The entry that reverses `original` on `reverseDate`: every posting negated, same partner on
 * each line, same source type so the roll-forward bucket it lands in is the one it takes back.
 */
export function reversalOf(original: ReversibleEntry, reverseDate: string): JournalEntry {
  return {
    fundId: original.fundId,
    entryDate: reverseDate,
    memo: `Reversal of ${original.memo?.trim() || `entry ${original.id.slice(0, 8)}`}`,
    sourceType: original.sourceType ?? 'manual',
    sourceRef: reversalRef(original.id),
    reference: original.reference ?? null,
    postings: original.postings.map(p => ({
      accountId: p.accountId,
      amount: roundCents(-p.amount),
      currency: p.currency,
      lpEntityId: p.lpEntityId ?? null,
    })),
  }
}
