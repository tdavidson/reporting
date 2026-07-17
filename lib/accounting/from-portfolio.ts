// Portfolio → ledger: a transaction recorded in the tracker drafts the journal entry
// it implies, for review.
//
// WHY A DRAFT AND NOT A POST. The tracker is where you record *what happened* — a
// round, a mark, a rate move, an exit. The ledger records what the fund *carries*. They
// have to agree, and the per-company tie-out now proves whether they do. But the entry
// a transaction implies isn't always the entry you want (a cost basis may need
// splitting, an exit may have escrow, a period may be closed), so nothing posts itself.
// It lands as a draft in the journal and waits for you.
//
// WHAT IT REFUSES TO GUESS. A row with no `portfolio_group` is company-wide pricing —
// a round the fund didn't participate in still re-prices the position, but in WHICH
// vehicle? Two funds holding the same company both re-price, by different amounts, and
// guessing would post to the wrong books. Those return a reason instead of an entry.
// Same for `round_info`: it is a price signal, not a fund transaction. The mark it
// implies flows through the position's fair value, which the tie-out will surface.
//
// NOTHING HERE MAY THROW INTO THE CALLER. Recording an investment must not fail because
// the ledger hiccuped — the caller reports `LedgerDraftResult` alongside the saved
// transaction and the user decides what to do.

import type { SupabaseClient } from '@supabase/supabase-js'
import { accountIdByCode, persistEntry } from './persist'
import { ensureInvestmentAccounts } from './investments'
import { loadPostedLedger } from './load'
import { closedPeriodRanges, dateInAnyClosedPeriod } from './periods'
import { vehicleIdByName } from './vehicle-id'
import { roundCents } from './ledger'
import type { JournalEntry, Posting } from './types'

const CASH = '1000'
const ESCROW_RECEIVABLE = '1350'
const REALIZED_GAIN = '4000'
const UNREALIZED_INCOME = '4200'
const FX_INCOME = '4300'

export interface LedgerDraftResult {
  /** A draft entry was created and is waiting in the journal. */
  drafted: boolean
  entryId?: string
  /** What kind of entry, for the message shown back. */
  kind?: 'investment' | 'valuation' | 'fx_revaluation' | 'proceeds' | 'conversion'
  amount?: number
  vehicle?: string
  /** Why nothing was drafted — always set when `drafted` is false. */
  reason?: string
  /**
   * The vehicle simply isn't on the ledger yet — as opposed to a real problem with this row.
   *
   * A fund that has never onboarded a vehicle to accounting hasn't done anything wrong, so its
   * every save shouldn't read like a warning. Callers use this to soften the message into an
   * invitation. It is a flag rather than a string match on `reason` because the sentence is
   * copy and will be rewritten; the condition is behaviour and won't.
   */
  notOnboarded?: boolean
}

const skip = (reason: string): LedgerDraftResult => ({ drafted: false, reason })

/** Skipped only because this vehicle keeps no books yet. Nothing to fix, something to offer. */
const skipNotOnboarded = (vehicle: string, reason: string): LedgerDraftResult =>
  ({ drafted: false, reason, notOnboarded: true, vehicle })

/** The `source_ref` that ties a journal entry back to the tracker row that drafted it. */
export const txnRef = (txnId: string) => `txn:${txnId}`

export interface LedgerRetractResult {
  /** How many entries were removed or voided. */
  retracted: number
  /** Set when an entry could NOT be retracted — the caller must tell the user. */
  reason?: string
}

/**
 * Undo the ledger side of a tracker transaction that is being edited or deleted.
 *
 * A DRAFT is deleted: it was never part of the books. A POSTED entry is VOIDED, never
 * silently deleted — it is real history, and someone reconciled it.
 *
 * An entry inside a CLOSED period cannot be touched at all. We refuse and say so, rather
 * than letting the tracker and the ledger drift apart without telling anyone — which is
 * exactly what happened before, when edit and delete simply didn't look at the ledger.
 */
export async function retractEntriesForTransaction(
  admin: SupabaseClient,
  fundId: string,
  txnId: string
): Promise<LedgerRetractResult> {
  try {
    const { data: entries } = await admin
      .from('journal_entries' as any)
      .select('id, status, entry_date, portfolio_group')
      .eq('fund_id', fundId)
      .eq('source_ref', txnRef(txnId))
      .neq('status', 'void')

    const rows = (entries as any[]) ?? []
    if (rows.length === 0) return { retracted: 0 }

    let retracted = 0
    for (const e of rows) {
      const closed = await closedPeriodRanges(admin, fundId, e.portfolio_group)
      if (e.entry_date && dateInAnyClosedPeriod(closed, e.entry_date)) {
        return {
          retracted,
          reason: `Its journal entry is dated ${e.entry_date}, inside a closed period. Reopen the period to change it — the tracker and the ledger would otherwise disagree.`,
        }
      }

      if (e.status === 'draft') {
        await admin.from('journal_entries' as any).delete().eq('id', e.id).eq('fund_id', fundId)
      } else {
        await admin.from('journal_entries' as any)
          .update({ status: 'void', posted_at: null })
          .eq('id', e.id).eq('fund_id', fundId)
      }
      retracted++
    }
    return { retracted }
  } catch (e) {
    return { retracted: 0, reason: (e as Error).message }
  }
}

/**
 * Re-mirror an edited transaction: retract whatever it drafted before, then draft afresh
 * from its new values.
 */
export async function redraftEntryForTransaction(
  admin: SupabaseClient,
  fundId: string,
  userId: string | null,
  txn: any,
  companyName: string
): Promise<LedgerDraftResult> {
  const retracted = await retractEntriesForTransaction(admin, fundId, txn.id)
  if (retracted.reason) return skip(retracted.reason)
  return draftEntryForTransaction(admin, fundId, userId, txn, companyName)
}

export interface ExitInputs {
  /** Cash actually received on the exit. */
  proceeds: number
  /**
   * Holdback the buyer retained in escrow. Earned at the exit, but not yet paid — so it is
   * recognized as a RECEIVABLE, not as cash. The tracker already counts it in proceeds
   * (lib/investments.ts:75); booking only the cash made the ledger's realized gain differ
   * from the tracker's by exactly this amount on every exit with a holdback.
   */
  escrow?: number
  /** Cost basis being retired (always treated as a magnitude). */
  basis: number
  /** What the ledger currently carries for this company. */
  carried: { cost: number; unrealized: number; fx: number }
}

export interface ExitAccounts {
  cashId: string
  gainId: string
  costId: string
  unrealizedId: string
  fxId: string
  escrowId?: string
  unrealizedIncomeId?: string
  fxIncomeId?: string
}

/**
 * The postings an exit implies — pure, so the reversal arithmetic can be tested directly.
 *
 * Cash in, cost retired, realized gain as the plug — AND the accumulated marks unwound.
 * Retiring only the cost (which is what this used to do) left the position's 1200 unrealized
 * and 1250 FX balances on the balance sheet for a company the fund no longer owns, and
 * double-counted the appreciation in cumulative P&L: once as unrealized marks (4200), and
 * again inside the full realized gain (4000).
 *
 * Unwinding is a RECLASSIFICATION, not a new gain: crediting the asset and debiting the
 * income account that recognised it nets to zero on cumulative P&L. The gain simply moves
 * from unrealized to realized, which is precisely what an exit is.
 *
 * A partial exit unwinds pro-rata to the cost basis retired.
 */
export function exitPostings(inputs: ExitInputs, acc: ExitAccounts, currency = 'USD'): Posting[] {
  const proceeds = roundCents(inputs.proceeds)
  const escrow = roundCents(inputs.escrow ?? 0)
  const basis = Math.abs(roundCents(inputs.basis))
  const { cost: priorCost, unrealized, fx } = inputs.carried

  // How much of the position is leaving. With no cost on the books to apportion against,
  // there is nothing partial about it — take the whole mark off.
  const fraction = priorCost > 0
    ? Math.min(1, basis / priorCost)
    : 1

  const unrealizedOut = roundCents(unrealized * fraction)
  const fxOut = roundCents(fx * fraction)

  // The gain is measured on TOTAL consideration — cash plus the holdback the fund has earned
  // but not yet collected. This is what makes the ledger agree with the tracker, which counts
  // escrow in proceeds at close.
  const consideration = roundCents(proceeds + (acc.escrowId ? escrow : 0))
  const gain = roundCents(consideration - basis)

  const postings: Posting[] = [
    { accountId: acc.cashId, amount: proceeds, currency, lpEntityId: null },
    { accountId: acc.costId, amount: roundCents(-basis), currency, lpEntityId: null },
  ]
  // Dr escrow receivable. It clears when the money lands (a bank inflow categorized to 1350).
  if (escrow !== 0 && acc.escrowId) {
    postings.push({ accountId: acc.escrowId, amount: escrow, currency, lpEntityId: null })
  }
  if (gain !== 0) {
    postings.push({ accountId: acc.gainId, amount: roundCents(-gain), currency, lpEntityId: null })
  }
  if (unrealizedOut !== 0 && acc.unrealizedIncomeId) {
    postings.push({ accountId: acc.unrealizedId, amount: roundCents(-unrealizedOut), currency, lpEntityId: null })
    postings.push({ accountId: acc.unrealizedIncomeId, amount: roundCents(unrealizedOut), currency, lpEntityId: null })
  }
  if (fxOut !== 0 && acc.fxIncomeId) {
    postings.push({ accountId: acc.fxId, amount: roundCents(-fxOut), currency, lpEntityId: null })
    postings.push({ accountId: acc.fxIncomeId, amount: roundCents(fxOut), currency, lpEntityId: null })
  }
  return postings
}

export interface ConversionInputs {
  /** The source instrument's cost basis, already sitting in 1100 from its own purchase date. */
  carriedPrincipal: number
  /** Accrued interest capitalizing into equity basis at conversion (0 for a SAFE). */
  interest: number
  /** New cash written into the priced round, if any. */
  newCash: number
  shares: number
  price: number
}

export interface ConversionAccounts {
  costId: string
  cashId: string
  unrealizedId: string
  /** Absent on a chart seeded before notes — the caller refuses interest conversion without it. */
  accruedInterestId?: string
  /** 4200. Absent on an unsynced chart — the caller refuses a step-up without it. */
  unrealizedIncomeId?: string
}

/**
 * The postings a SAFE/note conversion implies — pure, so the arithmetic can be tested directly.
 *
 * The source principal is ALREADY in 1100 (posted on its own purchase date) and is never
 * re-posted. Three independently-balanced pieces, all dated on the conversion:
 *   • interest capitalizes into basis     Dr 1100 / Cr 1150
 *   • new cash at the round                Dr 1100 / Cr 1000
 *   • step-up to the round price           Dr 1200 / Cr 4200   (negative = a down-round loss)
 *
 * With no round price we hold at carried cost (no step-up). No cash leg on a pure conversion, so
 * it surfaces in the cash-flow statement's non-cash section rather than as an outflow.
 */
export function conversionPostings(inputs: ConversionInputs, acc: ConversionAccounts, currency = 'USD'): Posting[] {
  const interest = roundCents(inputs.interest)
  const newCash = roundCents(inputs.newCash)
  const carriedBasis = roundCents(inputs.carriedPrincipal + interest + newCash)
  const roundValue = inputs.shares > 0 && inputs.price > 0 ? roundCents(inputs.shares * inputs.price) : carriedBasis
  const stepUp = roundCents(roundValue - carriedBasis)

  const costDebit = roundCents(interest + newCash)
  const postings: Posting[] = []
  if (costDebit !== 0) postings.push({ accountId: acc.costId, amount: costDebit, currency, lpEntityId: null })
  if (interest !== 0 && acc.accruedInterestId) postings.push({ accountId: acc.accruedInterestId, amount: roundCents(-interest), currency, lpEntityId: null })
  if (newCash !== 0) postings.push({ accountId: acc.cashId, amount: roundCents(-newCash), currency, lpEntityId: null })
  if (stepUp !== 0 && acc.unrealizedIncomeId) {
    postings.push({ accountId: acc.unrealizedId, amount: stepUp, currency, lpEntityId: null })
    postings.push({ accountId: acc.unrealizedIncomeId, amount: roundCents(-stepUp), currency, lpEntityId: null })
  }
  return postings
}

/**
 * What the LEDGER currently carries for one company: its cost, its accumulated unrealized
 * mark, and its accumulated FX translation.
 *
 * Read from the books rather than from the tracker on purpose. The exit entry has to unwind
 * exactly what was posted — if the tracker and the ledger have drifted (which the per-company
 * tie-out surfaces but does not prevent), unwinding the tracker's view would leave a residue
 * on the balance sheet, which is the very bug this is fixing.
 */
async function companyCarrying(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  accts: { costId: string; unrealizedId: string; fxId: string }
): Promise<{ cost: number; unrealized: number; fx: number }> {
  const { postings } = await loadPostedLedger(admin, fundId, group)
  const sum = (accountId: string) =>
    roundCents(
      postings
        .filter(p => p.accountId === accountId)
        .reduce((s, p) => s + p.amount, 0)
    )
  return {
    cost: sum(accts.costId),
    unrealized: sum(accts.unrealizedId),
    fx: sum(accts.fxId),
  }
}

/**
 * Draft the journal entry a portfolio transaction implies. Returns why it didn't,
 * rather than throwing, when the transaction has no ledger meaning or the vehicle
 * isn't on the ledger at all.
 */
export async function draftEntryForTransaction(
  admin: SupabaseClient,
  fundId: string,
  userId: string | null,
  txn: any,
  companyName: string
): Promise<LedgerDraftResult> {
  try {
    const group: string | null = txn?.portfolio_group ?? null
    const companyId: string | null = txn?.company_id ?? null
    const entryDate: string | null = txn?.transaction_date ?? null

    if (!companyId) return skip('No company on the transaction.')
    if (!entryDate) return skip('No transaction date — the ledger needs one to place the entry in a period.')
    if (!group) {
      return skip(
        'This row has no vehicle, so it is company-wide pricing rather than a fund transaction. ' +
        'Tag it to a vehicle if it should hit the books.'
      )
    }
    if (txn.transaction_type === 'round_info') {
      return skip('A round is a price signal, not a fund transaction — no entry to book.')
    }

    // Is this vehicle even on the ledger? If the chart was never seeded, the fund isn't
    // doing accounting here and we say so quietly rather than seeding it behind their back.
    const vehicleId = await vehicleIdByName(admin, fundId, group)
    if (!vehicleId) return skipNotOnboarded(group, `No accounting vehicle named "${group}".`)
    const codes = await accountIdByCode(admin, fundId, group)
    if (codes.size === 0) {
      return skipNotOnboarded(group, `${group} has no chart of accounts — onboard it in Accounting to book entries.`)
    }

    const cashId = codes.get(CASH)
    if (!cashId) return skip(`${group} is missing account 1000 (Cash).`)

    const accts = await ensureInvestmentAccounts(admin, fundId, group, [{ id: companyId, name: companyName }])
    const a = accts.get(companyId)
    if (!a) return skip(`Could not resolve investment accounts for ${companyName}.`)

    const num = (v: any) => {
      const n = Number(v)
      return Number.isFinite(n) ? roundCents(n) : 0
    }

    let entry: JournalEntry | null = null
    let kind: LedgerDraftResult['kind']
    let amount = 0

    // ---- A conversion: a SAFE/note becomes priced equity. -------------------
    //
    // The source instrument's principal already sits in 1100 from its own purchase date, so it is
    // NOT re-posted here. What the conversion date DOES book, all in one entry:
    //   • accrued interest capitalizing into basis   Dr 1100  / Cr 1150
    //   • any new cash written at the priced round    Dr 1100  / Cr 1000
    //   • the step-up to the round price (or a down-round loss)  Dr 1200 / Cr 4200
    // No cash leg means a pure conversion lands in the cash-flow statement's non-cash section, and
    // the valuation change is dated on the conversion, not the original SAFE/note date.
    if (txn.transaction_type === 'investment' && txn.converts_from_txn_id) {
      const { data: source } = await admin
        .from('investment_transactions' as any)
        .select('investment_cost')
        .eq('id', txn.converts_from_txn_id)
        .eq('fund_id', fundId)
        .maybeSingle() as { data: { investment_cost: number | null } | null }
      const carriedPrincipal = num(source?.investment_cost)
      const interest = num(txn.interest_converted)
      const newCash = num(txn.investment_cost)
      const shares = num(txn.shares_acquired)
      const price = num(txn.share_price)
      const carriedBasis = roundCents(carriedPrincipal + interest + newCash)
      const roundValue = shares > 0 && price > 0 ? roundCents(shares * price) : carriedBasis

      if (interest !== 0 && !a.accruedInterestId) {
        return skip(`${group} has no accrued-interest account for ${companyName} — re-sync the chart of accounts to convert note interest.`)
      }
      const unrealizedIncomeId = codes.get(UNREALIZED_INCOME)
      if (roundCents(roundValue - carriedBasis) !== 0 && !unrealizedIncomeId) {
        return skip(`${group} is missing account ${UNREALIZED_INCOME} — re-sync the chart of accounts.`)
      }

      const postings = conversionPostings(
        { carriedPrincipal, interest, newCash, shares, price },
        { costId: a.costId, cashId, unrealizedId: a.unrealizedId, accruedInterestId: a.accruedInterestId, unrealizedIncomeId },
      )
      if (postings.length === 0) {
        return skip('This conversion carries no new cash, no converted interest, and no change in value — nothing to book.')
      }

      amount = roundValue
      kind = 'conversion'
      entry = {
        fundId,
        entryDate,
        sourceType: 'investment',
        memo: `Conversion to equity — ${companyName}${txn.round_name ? ` (${txn.round_name})` : ''}`,
        postings,
      }
    }

    // ---- A purchase: cash out, cost on the books. --------------------------
    else if (txn.transaction_type === 'investment') {
      const cost = num(txn.investment_cost)
      if (cost === 0) return skip('The investment has no cost — nothing to book.')
      amount = cost
      kind = 'investment'
      entry = {
        fundId,
        entryDate,
        sourceType: 'investment',
        memo: `Investment — ${companyName}${txn.round_name ? ` (${txn.round_name})` : ''}`,
        postings: [
          { accountId: a.costId, amount: cost, currency: 'USD', lpEntityId: null },
          { accountId: cashId, amount: roundCents(-cost), currency: 'USD', lpEntityId: null },
        ],
      }
    }

    // ---- A valuation change: either the company moved, or the currency did. -
    else if (txn.transaction_type === 'unrealized_gain_change') {
      const isFx = txn.valuation_change_source === 'fx'
      const delta = num(isFx ? (txn.fx_value_change ?? txn.unrealized_value_change) : txn.unrealized_value_change)
      if (delta === 0) return skip('The valuation did not change — nothing to book.')

      // The whole reason FX has its own accounts: a rate move is not investment
      // performance, and must never land in 1200/4200.
      const assetId = isFx ? a.fxId : a.unrealizedId
      const incomeCode = isFx ? FX_INCOME : UNREALIZED_INCOME
      const incomeId = codes.get(incomeCode)
      if (!incomeId) {
        return skip(`${group} is missing account ${incomeCode} — re-sync the chart of accounts.`)
      }

      amount = delta
      kind = isFx ? 'fx_revaluation' : 'valuation'
      const rates = txn.prior_fx_rate && txn.fx_rate
        ? ` (${txn.original_currency ?? 'FX'} ${txn.prior_fx_rate} → ${txn.fx_rate})`
        : ''
      entry = {
        fundId,
        entryDate,
        sourceType: isFx ? 'fx_revaluation' : 'valuation',
        memo: isFx
          ? `Foreign currency revaluation — ${companyName}${rates}`
          : `Mark to fair value — ${companyName}${txn.round_name ? ` (${txn.round_name})` : ''}`,
        postings: [
          { accountId: assetId, amount: delta, currency: 'USD', lpEntityId: null },
          { accountId: incomeId, amount: roundCents(-delta), currency: 'USD', lpEntityId: null },
        ],
      }
    }

    // ---- An exit: cash in, cost retired, the difference is a realized gain. -
    else if (txn.transaction_type === 'proceeds') {
      const proceeds = num(txn.proceeds_received)
      const escrow = num(txn.proceeds_escrow)
      const basis = Math.abs(num(txn.cost_basis_exited))
      if (proceeds === 0 && escrow === 0 && basis === 0) return skip('The exit has neither proceeds nor cost basis — nothing to book.')

      // Prefer the company's OWN realized-gain account (4000-<company>) so the ledger keeps which
      // deal produced the gain; fall back to the pooled 4000 for charts seeded before it existed.
      const gainId = a.realizedId ?? codes.get(REALIZED_GAIN)
      if (!gainId) return skip(`${group} is missing account ${REALIZED_GAIN} (Realized gains).`)

      // REVERSE THE ACCUMULATED MARKS ON THE WAY OUT.
      //
      // A position that was marked up carries a balance in its 1200 (unrealized) and 1250
      // (FX translation) accounts. Retiring only the COST on exit left those behind: a stale
      // mark sitting on the balance sheet for a company the fund no longer owns, and
      // cumulative P&L counting the same appreciation twice — once as the unrealized marks
      // (4200), and again inside the full realized gain (4000). The replay path has always
      // done this correctly (investments.ts drop-out reversal); the live draft did not.
      //
      // A partial exit reverses its share: the fraction of the cost basis being retired.
      const carried = await companyCarrying(admin, fundId, group, a)

      amount = proceeds
      kind = 'proceeds'
      entry = {
        fundId,
        entryDate,
        sourceType: 'realized_gain',
        memo: `Exit — ${companyName}${txn.round_name ? ` (${txn.round_name})` : ''}`,
        postings: exitPostings({ proceeds, escrow, basis, carried }, {
          cashId,
          gainId,
          costId: a.costId,
          unrealizedId: a.unrealizedId,
          fxId: a.fxId,
          // Absent on a chart seeded before 1350 existed. Without it the escrow can't be
          // recognized, so the entry falls back to cash-only — the old behaviour — rather
          // than posting an unbalanced entry. Re-syncing the chart adds it.
          escrowId: codes.get(ESCROW_RECEIVABLE),
          unrealizedIncomeId: codes.get(UNREALIZED_INCOME),
          fxIncomeId: codes.get(FX_INCOME),
        }),
      }
    }

    if (!entry) return skip(`No ledger entry is implied by a "${txn.transaction_type}" row.`)

    // Tag the entry with the transaction that produced it. Without this there is no link at
    // all between a tracker row and the entry it drafted — which is why editing or deleting a
    // transaction used to leave the ledger untouched and silently wrong. `source_ref` is the
    // same mechanism the close uses to find and void its own allocation entries.
    if (txn.id) entry.sourceRef = txnRef(txn.id)

    // Draft, never post. persistEntry still refuses a closed period — which is the right
    // answer, and worth surfacing rather than swallowing.
    const result = await persistEntry(admin, fundId, group, userId, entry, 'draft')
    if ('error' in result) return skip(result.error)

    return { drafted: true, entryId: result.entryId, kind, amount, vehicle: group }
  } catch (e) {
    // The portfolio write already succeeded. A ledger failure must not undo it.
    return skip(e instanceof Error ? e.message : 'Could not draft a journal entry.')
  }
}
