// The owner's-equity close. Pure.
//
// A fund's close allocates each P&L category across the partners by their basis. A management
// company and an individual have no partners: net income goes to one equity account — members'
// capital, or the owner's capital — and there is nothing to split. The shape is otherwise the
// partner close's: one entry per category, offset through the bridge, tagged with the period's
// source_ref so reopening voids exactly these. See close.ts for the partner path and the reasons
// behind one-entry-per-category.

import type { JournalEntry } from './types'
import { roundCents } from './ledger'

export interface OwnerCloseCategory {
  sourceType: string
  label: string
  /** Net effect on equity: positive increases it. */
  capitalEffect: number
}

export interface OwnerCloseContext {
  fundId: string
  /** 3200 Undistributed earnings. */
  bridgeId: string
  /** The single equity account net income rolls into (subtype members_capital). */
  ownerCapitalId: string
  periodStart: string
  periodEnd: string
  sourceRef: string
  label?: string | null
  /** "the owner" / "the members", for the memo. */
  ownerNoun: string
  currency?: string
}

/**
 * One balanced entry per category: Dr/Cr the bridge for the category's effect, the opposite on
 * the owner's capital account. The bridge side is signed exactly as the partner close signs it,
 * so a mixed vehicle history (a fund converted to an individual's books, say) reads the same.
 */
export function ownerCloseEntries(categories: OwnerCloseCategory[], ctx: OwnerCloseContext): JournalEntry[] {
  const currency = ctx.currency ?? 'USD'
  return categories
    .filter(c => roundCents(c.capitalEffect) !== 0)
    .map(cat => ({
      fundId: ctx.fundId,
      entryDate: ctx.periodEnd,
      memo: `${ctx.label ?? `${ctx.periodStart} → ${ctx.periodEnd}`} close — ${cat.label} to ${ctx.ownerNoun}`,
      sourceType: cat.sourceType,
      sourceRef: ctx.sourceRef,
      postings: [
        { accountId: ctx.bridgeId, amount: roundCents(cat.capitalEffect), currency, lpEntityId: null },
        { accountId: ctx.ownerCapitalId, amount: roundCents(-cat.capitalEffect), currency, lpEntityId: null },
      ],
    }))
}
