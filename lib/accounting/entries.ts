// Journal-entry builders. Each turns an engine result into ONE balanced entry
// with a single source_type, so the capital-account roll-forward buckets it
// correctly. Allocations post directly to LP capital (debit positive, so a
// credit that increases capital is negative), offset to the real account.
//
// Sign convention: contributions/gains credit LP capital (negative posting);
// distributions/fees/expenses/carry debit LP capital (positive posting).

import { roundCents, assertBalanced } from './ledger'
import { allocateAmount, type LpOwnership } from './allocation'
import type { FeeResult } from './fees'
import type { JournalEntry, Posting } from './types'

export type CapitalAccountMap = Map<string, string> // lpEntityId → account_id

interface Base {
  fundId: string
  entryDate: string
  memo?: string
}

function lpDebit(capMap: CapitalAccountMap, lpEntityId: string, amount: number, currency = 'USD'): Posting {
  const accountId = capMap.get(lpEntityId)
  if (!accountId) throw new Error(`No capital account for LP entity ${lpEntityId}`)
  return { accountId, amount: roundCents(amount), currency, lpEntityId }
}

function finalize(base: Base, sourceType: string, postings: Posting[]): JournalEntry {
  const entry: JournalEntry = { fundId: base.fundId, entryDate: base.entryDate, memo: base.memo, sourceType, postings }
  assertBalanced(entry)
  return entry
}

/** Capital call: debit cash, credit each LP's capital pro-rata by commitment. */
export function buildCapitalCallEntry(
  base: Base,
  total: number,
  owners: LpOwnership[],
  capMap: CapitalAccountMap,
  cashAccountId: string,
  currency = 'USD'
): JournalEntry {
  const alloc = allocateAmount(total, owners)
  const postings: Posting[] = [{ accountId: cashAccountId, amount: roundCents(total), currency, lpEntityId: null }]
  for (const [lpEntityId, share] of Array.from(alloc.entries())) {
    postings.push(lpDebit(capMap, lpEntityId, -share, currency)) // credit LP capital
  }
  return finalize(base, 'capital_call', postings)
}

/** Distribution: debit each LP's capital, credit cash. `perLp` amounts per LP. */
export function buildDistributionEntry(
  base: Base,
  perLp: Map<string, number>,
  capMap: CapitalAccountMap,
  cashAccountId: string,
  currency = 'USD'
): JournalEntry {
  let total = 0
  const postings: Posting[] = []
  for (const [lpEntityId, amt] of Array.from(perLp.entries())) {
    total = roundCents(total + amt)
    postings.push(lpDebit(capMap, lpEntityId, amt, currency))
  }
  postings.push({ accountId: cashAccountId, amount: roundCents(-total), currency, lpEntityId: null })
  return finalize(base, 'distribution', postings)
}

/**
 * Accounts a compound P&L-and-capital entry touches. The P&L account keeps the
 * income statement correct; the bridge (undistributed earnings) offsets the
 * per-LP capital allocation so both statements are right at once, and the period
 * close later zeroes the bridge against the P&L.
 */
export interface BridgeAccounts {
  /** The income/expense account for the income statement. */
  pnlAccountId: string
  /** Undistributed-earnings bridge (equity). */
  bridgeAccountId: string
  /** Cash or Due-to-GP — the real asset/liability side. */
  offsetAccountId: string
}

/**
 * Management fee (compound, via the bridge):
 *   Dr Management fee expense (P&L, total)     Cr Due to GP / Cash (total)
 *   Dr each LP capital (their fee)             Cr Undistributed earnings (total)
 * The income statement shows the expense; each LP's capital is reduced now; the
 * period close later nets the bridge against the expense.
 */
export function buildManagementFeeEntry(
  base: Base,
  fee: FeeResult,
  capMap: CapitalAccountMap,
  accts: BridgeAccounts,
  currency = 'USD'
): JournalEntry {
  const postings: Posting[] = [
    { accountId: accts.pnlAccountId, amount: roundCents(fee.total), currency, lpEntityId: null },
    { accountId: accts.offsetAccountId, amount: roundCents(-fee.total), currency, lpEntityId: null },
    { accountId: accts.bridgeAccountId, amount: roundCents(-fee.total), currency, lpEntityId: null },
  ]
  for (const line of fee.lines) {
    if (line.fee === 0) continue
    postings.push(lpDebit(capMap, line.lpEntityId, line.fee, currency)) // reduce LP capital
  }
  return finalize(base, 'management_fee', postings)
}

/**
 * Partnership expense (compound, via the bridge): pro-rata by commitment.
 *   Dr Partnership expense (P&L, total)   Cr Cash (total)
 *   Dr each LP capital (share)            Cr Undistributed earnings (total)
 */
export function buildExpenseEntry(
  base: Base,
  total: number,
  owners: LpOwnership[],
  capMap: CapitalAccountMap,
  accts: BridgeAccounts,
  currency = 'USD'
): JournalEntry {
  const alloc = allocateAmount(total, owners)
  const postings: Posting[] = [
    { accountId: accts.pnlAccountId, amount: roundCents(total), currency, lpEntityId: null },
    { accountId: accts.offsetAccountId, amount: roundCents(-total), currency, lpEntityId: null },
    { accountId: accts.bridgeAccountId, amount: roundCents(-total), currency, lpEntityId: null },
  ]
  for (const [lpEntityId, share] of Array.from(alloc.entries())) {
    postings.push(lpDebit(capMap, lpEntityId, share, currency))
  }
  return finalize(base, 'partnership_expense', postings)
}

/**
 * Realized gain / income (compound, via the bridge): increases capital.
 *   Dr Cash / Investment (total)          Cr Realized gains income (P&L, total)
 *   Dr Undistributed earnings (total)     Cr each LP capital (share)
 */
export function buildGainEntry(
  base: Base,
  total: number,
  owners: LpOwnership[],
  capMap: CapitalAccountMap,
  accts: BridgeAccounts,
  currency = 'USD'
): JournalEntry {
  const alloc = allocateAmount(total, owners)
  const postings: Posting[] = [
    { accountId: accts.offsetAccountId, amount: roundCents(total), currency, lpEntityId: null },  // Dr asset
    { accountId: accts.pnlAccountId, amount: roundCents(-total), currency, lpEntityId: null },     // Cr income
    { accountId: accts.bridgeAccountId, amount: roundCents(total), currency, lpEntityId: null },    // Dr bridge
  ]
  for (const [lpEntityId, share] of Array.from(alloc.entries())) {
    postings.push(lpDebit(capMap, lpEntityId, -share, currency)) // credit LP capital (increase)
  }
  return finalize(base, 'realized_gain', postings)
}

/**
 * Investment revaluation: mark the portfolio to a new fair value. `delta` is the
 * change vs the current carrying value (positive = mark up). Books the unrealized
 * change to the unrealized-appreciation asset and income, and allocates it per LP
 * through the bridge — the same shape as a gain, tagged `valuation`.
 *   Dr Unrealized appreciation (delta)   Cr Change in unrealized income (delta)
 *   Dr Undistributed earnings (delta)    Cr each LP capital (share)
 */
export function buildRevaluationEntry(
  base: Base,
  delta: number,
  owners: LpOwnership[],
  capMap: CapitalAccountMap,
  accts: { unrealizedAssetId: string; incomeId: string; bridgeId: string },
  currency = 'USD'
): JournalEntry {
  const alloc = allocateAmount(delta, owners)
  const postings: Posting[] = [
    { accountId: accts.unrealizedAssetId, amount: roundCents(delta), currency, lpEntityId: null },
    { accountId: accts.incomeId, amount: roundCents(-delta), currency, lpEntityId: null },
    { accountId: accts.bridgeId, amount: roundCents(delta), currency, lpEntityId: null },
  ]
  for (const [lpEntityId, share] of Array.from(alloc.entries())) {
    postings.push(lpDebit(capMap, lpEntityId, -share, currency))
  }
  return finalize(base, 'valuation', postings)
}

/**
 * Period close: zero every P&L account into the bridge. Given each P&L account's
 * debit-side balance, post the negation to flatten it and offset the sum to the
 * bridge — which, because the compound entries already parked the allocation
 * there, nets the bridge back to zero. Capital was updated by those entries, so
 * this touches no LP accounts.
 */
export function buildPeriodCloseEntry(
  base: Base,
  pnlBalances: { accountId: string; balance: number }[],
  bridgeAccountId: string,
  currency = 'USD'
): JournalEntry {
  const nonzero = pnlBalances.filter(b => roundCents(b.balance) !== 0)
  if (nonzero.length === 0) throw new Error('Nothing to close — no P&L balances')
  let sum = 0
  const postings: Posting[] = nonzero.map(b => {
    sum = roundCents(sum + b.balance)
    return { accountId: b.accountId, amount: roundCents(-b.balance), currency, lpEntityId: null }
  })
  postings.push({ accountId: bridgeAccountId, amount: roundCents(sum), currency, lpEntityId: null })
  return finalize(base, 'period_close', postings)
}

/** Carried interest: debit each LP's capital by their carry share, credit GP capital. */
export function buildCarryEntry(
  base: Base,
  perLpCarry: Map<string, number>,
  capMap: CapitalAccountMap,
  gpCapitalAccountId: string,
  currency = 'USD'
): JournalEntry {
  let total = 0
  const postings: Posting[] = []
  for (const [lpEntityId, amt] of Array.from(perLpCarry.entries())) {
    if (amt === 0) continue
    total = roundCents(total + amt)
    postings.push(lpDebit(capMap, lpEntityId, amt, currency))
  }
  postings.push({ accountId: gpCapitalAccountId, amount: roundCents(-total), currency, lpEntityId: null })
  return finalize(base, 'carried_interest', postings)
}
