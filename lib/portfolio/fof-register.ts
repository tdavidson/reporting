import type { SupabaseClient } from '@supabase/supabase-js'
import { draftEntryForTransaction } from '@/lib/accounting/from-portfolio'

/**
 * The register produces ordinary investment_transactions rows. It is the ONLY thing that
 * distinguishes a fund holding from a company holding below the register — everything after
 * this point (ledger posting, marks, exits, capital accounts, SOI, close) is the existing path.
 *
 * WHY A CALL CAPITALIZES IN FULL. An underlying manager calls capital for investments, its own
 * management fee, and partnership expenses. Under ASC 946 all of it is our cost basis in the
 * fund — the manager's fee is not our expense. The purpose split is captured for disclosure,
 * not to route different amounts to different accounts.
 */

export interface RegisterEvent {
  companyId: string
  kind: 'call' | 'distribution'
  eventDate: string
  amount: number
  recallableAmount: number
  charReturnOfCapital: number
  charRealizedGain: number
  charIncome: number
  purposeInvestments: number
  purposeFees: number
  purposeExpenses: number
}

export interface RegisterNav {
  companyId: string
  asOfDate: string
  reportedNav: number
  basis: 'final' | 'preliminary' | 'estimate'
}

export interface TransactionDraft {
  company_id: string
  transaction_type: 'investment' | 'proceeds' | 'unrealized_gain_change'
  transaction_date: string
  investment_cost?: number
  proceeds_received?: number
  cost_basis_exited?: number
  unrealized_value_change?: number
  notes?: string
}

/** Events before the cut-over were already posted by the migrated system — see Plan 3. */
const posts = (date: string, ledgerStartDate: string | null) =>
  !ledgerStartDate || date >= ledgerStartDate

const CENT = 0.005

export function transactionForEvent(
  e: RegisterEvent,
  opts: { ledgerStartDate: string | null },
): TransactionDraft | null {
  if (!posts(e.eventDate, opts.ledgerStartDate)) return null

  if (e.kind === 'call') {
    const split = e.purposeInvestments + e.purposeFees + e.purposeExpenses
    // A split that does not add up means a mistyped notice. Refuse it here rather than
    // capitalizing a number nobody can trace back to the manager's letter.
    if (Math.abs(split - e.amount) > CENT) {
      throw new Error(`Call purpose split (${split}) does not sum to the amount (${e.amount}).`)
    }
    return {
      company_id: e.companyId,
      transaction_type: 'investment',
      transaction_date: e.eventDate,
      investment_cost: e.amount,
    }
  }

  const split = e.charReturnOfCapital + e.charRealizedGain + e.charIncome
  if (Math.abs(split - e.amount) > CENT) {
    throw new Error(`Distribution character split (${split}) does not sum to the amount (${e.amount}).`)
  }
  return {
    company_id: e.companyId,
    transaction_type: 'proceeds',
    transaction_date: e.eventDate,
    proceeds_received: e.amount,
    // Only the return-of-capital character retires basis; gain and income do not.
    cost_basis_exited: e.charReturnOfCapital,
  }
}

/**
 * The mark a NAV statement implies, dated AT the statement's as-of date.
 *
 * No roll-forward here, deliberately: at the as-of date itself there are no later cash flows
 * to roll, so marking to the reported NAV is exact. The rolled-forward figure from
 * fof-metrics.ts is what a PERIOD-END mark uses when the newest statement is older than the
 * period — that mark is derived at close and belongs to Plan 2.
 */
export function transactionForNav(
  n: RegisterNav,
  opts: { carriedValue: number; ledgerStartDate: string | null },
): TransactionDraft | null {
  if (!posts(n.asOfDate, opts.ledgerStartDate)) return null
  const delta = n.reportedNav - opts.carriedValue
  if (Math.abs(delta) < CENT) return null      // ledger already agrees — no empty entry
  return {
    company_id: n.companyId,
    transaction_type: 'unrealized_gain_change',
    transaction_date: n.asOfDate,
    unrealized_value_change: delta,
  }
}

export interface ConfirmResult {
  ok: boolean
  transactionId?: string
  skipped?: 'before_ledger_start' | 'no_change'
  error?: string
}

/**
 * Confirm a draft register row: produce its transaction, draft the ledger entry through the
 * existing path, and back-link the two. Idempotent — a row already carrying a transaction id
 * returns it rather than producing a second one.
 */
export async function confirmFundCapitalEvent(
  admin: SupabaseClient,
  fundId: string,
  userId: string,
  eventId: string,
): Promise<ConfirmResult> {
  const { data: row } = await (admin as any)
    .from('fund_capital_events')
    .select('*').eq('id', eventId).eq('fund_id', fundId).maybeSingle()
  if (!row) return { ok: false, error: 'Event not found.' }
  if (row.investment_transaction_id) {
    return { ok: true, transactionId: row.investment_transaction_id }
  }

  const { data: settings } = await (admin as any)
    .from('vehicle_accounting_settings')
    .select('ledger_start_date')
    .eq('fund_id', fundId).eq('vehicle_id', row.vehicle_id)
    .maybeSingle()

  let draft: TransactionDraft | null
  try {
    draft = transactionForEvent(toRegisterEvent(row), {
      ledgerStartDate: settings?.ledger_start_date ?? null,
    })
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  if (!draft) {
    // Memo-only history. Confirmed, but nothing posts.
    await (admin as any).from('fund_capital_events')
      .update({ status: 'confirmed' }).eq('id', eventId).eq('fund_id', fundId)
    return { ok: true, skipped: 'before_ledger_start' }
  }

  const { data: txn, error } = await (admin as any)
    .from('investment_transactions')
    .insert({ ...draft, fund_id: fundId })
    .select('id').single()
  if (error || !txn) return { ok: false, error: error?.message ?? 'Insert failed.' }

  await (admin as any).from('fund_capital_events')
    .update({ status: 'confirmed', investment_transaction_id: txn.id })
    .eq('id', eventId).eq('fund_id', fundId)

  const { data: holding } = await admin
    .from('companies').select('name').eq('id', row.company_id).maybeSingle()
  await draftEntryForTransaction(admin, fundId, userId, txn, (holding as any)?.name ?? 'Fund')

  return { ok: true, transactionId: txn.id }
}

function toRegisterEvent(row: any): RegisterEvent {
  return {
    companyId: row.company_id,
    kind: row.kind,
    eventDate: row.event_date,
    amount: Number(row.amount),
    recallableAmount: Number(row.recallable_amount ?? 0),
    charReturnOfCapital: Number(row.char_return_of_capital ?? 0),
    charRealizedGain: Number(row.char_realized_gain ?? 0),
    charIncome: Number(row.char_income ?? 0),
    purposeInvestments: Number(row.purpose_investments ?? 0),
    purposeFees: Number(row.purpose_fees ?? 0),
    purposeExpenses: Number(row.purpose_expenses ?? 0),
  }
}
