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
  /** Set for per-investment sub-accounts (1100-<companyId> cost, 1200-<companyId> unrealized). */
  companyId?: string | null
}

export interface Posting {
  accountId: string
  /** Signed: debit > 0, credit < 0. */
  amount: number
  currency: string
  /** Optional per-LP dimension for allocation. */
  lpEntityId?: string | null
  /**
   * The parent entry's date (YYYY-MM-DD). Set by loadPostedLedger. Needed to scope
   * period statements: a balance sheet is cumulative to a date, but the income
   * statement and cash flows cover a window.
   */
  entryDate?: string | null
}

export interface JournalEntry {
  id?: string
  fundId: string
  /** ISO date (YYYY-MM-DD). */
  entryDate: string
  memo?: string | null
  sourceType?: string | null
  /** The system's tag — close:<period>, qb:<hash>, reversal:<entry>. Never typed by a person. */
  sourceRef?: string | null
  /** The person's own reference — a check number, an invoice, a notice. Free text. */
  reference?: string | null
  /** An adjusting entry: a period-end correction, listed on its own for the preparer. */
  adjusting?: boolean
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
