// Core types for the fund-accounting double-entry ledger.
//
// Amounts are signed: debits are positive, credits are negative. An entry is
// balanced when its postings sum to zero within each currency. Money is carried
// in major units (e.g. dollars) rounded to cents; see roundCents in ledger.ts.

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense'

export type EntryStatus = 'draft' | 'posted' | 'void'

export interface Account {
  id: string
  fundId: string
  code: string
  name: string
  type: AccountType
  subtype?: string | null
  /** Set for per-LP capital sub-accounts. */
  lpEntityId?: string | null
}

export interface Posting {
  accountId: string
  /** Signed: debit > 0, credit < 0. */
  amount: number
  currency: string
  /** Optional per-LP dimension for allocation. */
  lpEntityId?: string | null
}

export interface JournalEntry {
  id?: string
  fundId: string
  /** ISO date (YYYY-MM-DD). */
  entryDate: string
  memo?: string | null
  sourceType?: string | null
  sourceRef?: string | null
  status?: EntryStatus
  postings: Posting[]
}

/** The natural (increasing) side of each account type. */
export const NORMAL_SIDE: Record<AccountType, 'debit' | 'credit'> = {
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  equity: 'credit',
  income: 'credit',
}
