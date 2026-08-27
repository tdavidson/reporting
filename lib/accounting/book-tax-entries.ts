// Turning a book-to-tax difference into a balanced entry in the tax book.
//
// book-tax.ts says WHAT differs and by how much. This says where the postings go. They are
// separate on purpose: the arithmetic is testable without a chart of accounts, and the account
// mapping is the part a fund's preparer might want to argue with.
//
// EVERY ENTRY HERE IS A REVERSAL. The actual book already recorded the transaction; the tax book
// only records the difference. So an adjustment posts the opposite of what book posted, to the
// same accounts wherever possible — which keeps the overlay legible: read the tax book alone and
// it is a short list of "not this" against the real ledger.
//
// The two exceptions are the costs tax capitalises. Reversing the expense needs somewhere to put
// the debit, and there is no such asset on the GAAP balance sheet, so 1400 and 1450 exist to
// receive it (see chart.ts).

import { roundCents, assertBalanced } from './ledger'
import type { JournalEntry, Posting } from './types'
import type { CapitalAccountMap } from './entries'
import type { ProposedAdjustment, TaxDifferenceKind } from './book-tax'

export interface TaxEntryBase {
  fundId: string
  entryDate: string
  memo?: string
}

/** The accounts a tax adjustment can touch. Resolved by the caller from the vehicle's chart. */
export interface TaxAdjustmentAccounts {
  /** 1200 — unrealized appreciation/(depreciation). */
  unrealizedAssetId: string
  /** 4200 — change in unrealized appreciation. */
  unrealizedIncomeId: string
  /** 5200 — organizational expenses. */
  organizationalExpenseId: string
  /** 1400 — deferred organizational costs (tax). */
  deferredOrgCostsId: string
  /** 5250 — syndication costs. */
  syndicationExpenseId: string
  /** 1450 — capitalized syndication costs (tax). */
  capitalizedSyndicationId: string
}

/** `source_type` per difference, so a tax entry can be found and reversed by kind. */
export const TAX_SOURCE_TYPE: Record<TaxDifferenceKind, string> = {
  unrealized: 'tax_adj_unrealized',
  carry_on_unrealized: 'tax_adj_carry',
  organizational_709: 'tax_adj_org_709',
  syndication: 'tax_adj_syndication',
}

function finalize(base: TaxEntryBase, sourceType: string, postings: Posting[]): JournalEntry {
  const entry: JournalEntry = {
    fundId: base.fundId,
    entryDate: base.entryDate,
    memo: base.memo,
    sourceType,
    postings,
  }
  assertBalanced(entry)
  return entry
}

/**
 * Reverse the mark: undo `amount` of unrealized appreciation.
 *
 * Book posted Dr 1200 / Cr 4200. This posts the exact opposite, so the tax book carries
 * positions at cost and recognises nothing until the position is actually sold.
 */
export function buildUnrealizedReversalEntry(
  base: TaxEntryBase,
  amount: number,
  accts: Pick<TaxAdjustmentAccounts, 'unrealizedAssetId' | 'unrealizedIncomeId'>,
  currency = 'USD',
): JournalEntry {
  const a = roundCents(amount)
  return finalize(base, TAX_SOURCE_TYPE.unrealized, [
    { accountId: accts.unrealizedIncomeId, amount: a, currency, lpEntityId: null },
    { accountId: accts.unrealizedAssetId, amount: roundCents(-a), currency, lpEntityId: null },
  ])
}

/**
 * Reverse the carry accrual, partner by partner.
 *
 * The close debited each LP's capital and credited the recipients'. Tax allocates carry only on
 * realization, so this puts it back — and it has to be per partner, because carry is an equity
 * reallocation. A single fund-level number would balance and still leave every partner's tax
 * capital wrong, which is the specific failure this whole ticket exists to prevent.
 *
 * `perLpReversal` is signed the way the capital accounts are: positive debits a partner's
 * capital, negative credits it. Pass the NEGATION of what the close posted.
 */
export function buildCarryReversalEntry(
  base: TaxEntryBase,
  perLpReversal: Map<string, number>,
  capMap: CapitalAccountMap,
  currency = 'USD',
): JournalEntry {
  const postings: Posting[] = []
  for (const [lpEntityId, amount] of Array.from(perLpReversal.entries())) {
    const a = roundCents(amount)
    if (a === 0) continue
    const accountId = capMap.get(lpEntityId)
    if (!accountId) throw new Error(`No capital account for LP entity ${lpEntityId}`)
    postings.push({ accountId, amount: a, currency, lpEntityId })
  }
  return finalize(base, TAX_SOURCE_TYPE.carry_on_unrealized, postings)
}

/**
 * Capitalise what §709 does not let the fund deduct yet.
 *
 * `amount` is book expense minus the year's allowable deduction. Positive means book deducted
 * more than tax allows, so the excess moves onto the balance sheet: Dr 1400 / Cr 5200. In a later
 * year, when tax amortizes and book has nothing left to expense, the amount is negative and the
 * entry runs the other way — the asset unwinds and tax takes the deduction.
 */
export function buildOrganizationalCostEntry(
  base: TaxEntryBase,
  amount: number,
  accts: Pick<TaxAdjustmentAccounts, 'organizationalExpenseId' | 'deferredOrgCostsId'>,
  currency = 'USD',
): JournalEntry {
  const a = roundCents(amount)
  return finalize(base, TAX_SOURCE_TYPE.organizational_709, [
    { accountId: accts.deferredOrgCostsId, amount: a, currency, lpEntityId: null },
    { accountId: accts.organizationalExpenseId, amount: roundCents(-a), currency, lpEntityId: null },
  ])
}

/**
 * Capitalise syndication costs, permanently.
 *
 * Same shape as the §709 entry and a different meaning: 1450 never amortizes, so this balance
 * only ever grows. It unwinds on liquidation and not before, which is why it does not share an
 * account with the organizational costs that do.
 */
export function buildSyndicationCostEntry(
  base: TaxEntryBase,
  amount: number,
  accts: Pick<TaxAdjustmentAccounts, 'syndicationExpenseId' | 'capitalizedSyndicationId'>,
  currency = 'USD',
): JournalEntry {
  const a = roundCents(amount)
  return finalize(base, TAX_SOURCE_TYPE.syndication, [
    { accountId: accts.capitalizedSyndicationId, amount: a, currency, lpEntityId: null },
    { accountId: accts.syndicationExpenseId, amount: roundCents(-a), currency, lpEntityId: null },
  ])
}

export interface BuildTaxEntriesInput {
  base: TaxEntryBase
  proposals: ProposedAdjustment[]
  accounts: TaxAdjustmentAccounts
  /** Required only when a carry adjustment is present. */
  carry?: { perLpReversal: Map<string, number>; capMap: CapitalAccountMap }
  currency?: string
}

export interface UnbuildableAdjustment {
  kind: TaxDifferenceKind
  reason: string
}

/**
 * Build one tax-book entry per proposed difference.
 *
 * A carry adjustment without its per-partner breakdown is REFUSED rather than posted at fund
 * level: a balanced entry that leaves every partner's capital wrong is worse than no entry,
 * because it looks done. Anything unbuildable comes back in `skipped` with the reason, so the
 * caller can say what is missing instead of silently producing a shorter list.
 */
export function buildTaxAdjustmentEntries(input: BuildTaxEntriesInput): {
  entries: JournalEntry[]
  skipped: UnbuildableAdjustment[]
} {
  const { base, proposals, accounts, carry } = input
  const currency = input.currency ?? 'USD'
  const entries: JournalEntry[] = []
  const skipped: UnbuildableAdjustment[] = []

  for (const p of proposals) {
    if (p.amount === 0) continue
    switch (p.kind) {
      case 'unrealized':
        entries.push(buildUnrealizedReversalEntry({ ...base, memo: p.label }, p.amount, accounts, currency))
        break
      case 'carry_on_unrealized': {
        if (!carry || carry.perLpReversal.size === 0) {
          skipped.push({
            kind: p.kind,
            reason:
              'Reversing accrued carry needs the per-partner split. Without it the entry would ' +
              'balance at fund level and leave every partner’s tax capital wrong.',
          })
          break
        }
        entries.push(
          buildCarryReversalEntry({ ...base, memo: p.label }, carry.perLpReversal, carry.capMap, currency),
        )
        break
      }
      case 'organizational_709':
        entries.push(buildOrganizationalCostEntry({ ...base, memo: p.label }, p.amount, accounts, currency))
        break
      case 'syndication':
        entries.push(buildSyndicationCostEntry({ ...base, memo: p.label }, p.amount, accounts, currency))
        break
    }
  }

  return { entries, skipped }
}
