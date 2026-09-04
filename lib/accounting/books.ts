// Which set of books a journal entry belongs to.
//
// `actual` is the real ledger — the one every existing surface means when it says "the books".
// `tax` holds book-to-tax adjusting entries (unrealized appreciation, carry accrued on unrealized
// gains, §709 organizational costs, syndication costs) and is read as an OVERLAY: a tax-basis
// figure is `actual + tax adjustments`, spliced at read time and never stored. That is what keeps
// the tax book to a handful of differences instead of a second copy of every transaction.
//
// See supabase/migrations/20260827000000_ledger_books.sql for the schema and for why a posting's
// book is derived from its entry rather than passed by the caller.

export type LedgerBook = 'actual' | 'tax'

export const LEDGER_BOOKS: LedgerBook[] = ['actual', 'tax']

/**
 * The real ledger.
 *
 * Nearly every query in this codebase wants exactly this and nothing else. Bank reconciliation,
 * capital-call booking, notices, the period close, the trial balance, statements as filed — all
 * of them are actual-book operations by policy, not by accident, and they say so by filtering on
 * this constant rather than relying on the absence of tax rows.
 */
export const ACTUAL_BOOK: LedgerBook = 'actual'

export function isLedgerBook(v: unknown): v is LedgerBook {
  return typeof v === 'string' && (LEDGER_BOOKS as string[]).includes(v)
}

/**
 * The basis a statement is read on. 'book' is the actual ledger — the default, and what every
 * caller that does not ask gets. 'tax' is the actual ledger PLUS the tax overlay, read together
 * and spliced at read time; the overlay alone is never a basis, because it holds differences,
 * not a ledger.
 */
export type StatementBasis = 'book' | 'tax'

export function booksForBasis(basis: StatementBasis): LedgerBook[] {
  return basis === 'tax' ? ['actual', 'tax'] : [ACTUAL_BOOK]
}

export function basisFromParam(v: string | null | undefined): StatementBasis {
  return v === 'tax' ? 'tax' : 'book'
}
