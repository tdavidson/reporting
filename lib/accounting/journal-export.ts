// The journal, the chart and the general ledger as rows — what a preparer keys from. Pure.
//
// Three shapes, one source:
//   • journalRows      — one row per posting, entry fields repeated, in the journal's own order.
//   • quickbooksJournalRows — the SAME entries in the layout of QuickBooks' Journal report, which
//     is the layout lib/accounting/quickbooks/parse-journal.ts reads. Date, type and num sit on a
//     transaction's first line only and are blank on its continuation lines, because that is how
//     QuickBooks prints it and how the parser groups it. The round trip is a test.
//   • generalLedgerRows — every account's register (lib/accounting/register.ts): opening balance,
//     each line with what it was booked against, running balance, closing balance.
//
// Money is a number here; lib/accounting/csv.ts writes it to two decimals, and the workbook
// writes it as a numeric cell.

import { accountRegister } from './register'
import type { RegisterPosting } from './register'
import type { Account } from './types'
import { NORMAL_SIDE } from './types'

export interface ExportPosting {
  accountCode: string
  accountName: string
  /** Signed: debit > 0, credit < 0. */
  amount: number
  currency: string
}

export interface ExportEntry {
  id: string
  entryDate: string
  memo: string | null
  sourceType: string | null
  sourceRef: string | null
  status: string
  adjusting?: boolean
  /** The user's reference (check, invoice). QuickBooks' Num, when present. */
  reference?: string | null
  /** The payee. QuickBooks' Name column. */
  vendorName?: string | null
  postings: ExportPosting[]
}

type Cell = string | number | null

/** Date, then id: the order the journal shows and the order a preparer expects to tick through. */
export function sortEntries<T extends { entryDate: string; id: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.id.localeCompare(b.id))
}

/** A short, stable handle for an entry. Until entries carry a reference of their own, the id's
 *  first eight characters — enough to find it again in the journal search. */
export const entryRef = (id: string) => id.slice(0, 8)

const accountLabel = (p: ExportPosting) => `${p.accountCode} · ${p.accountName}`

export const JOURNAL_HEADER = ['Date', 'Entry', 'Reference', 'Status', 'Adjusting', 'Source', 'Name', 'Memo', 'Account', 'Account name', 'Debit', 'Credit', 'Currency']

export function journalRows(entries: ExportEntry[]): Cell[][] {
  const rows: Cell[][] = [JOURNAL_HEADER]
  for (const e of sortEntries(entries)) {
    for (const p of e.postings) {
      rows.push([
        e.entryDate, entryRef(e.id), e.reference ?? '', e.status, e.adjusting ? 'yes' : '', e.sourceType ?? '', e.vendorName ?? '', e.memo ?? '',
        p.accountCode, p.accountName,
        p.amount > 0 ? p.amount : null,
        p.amount < 0 ? -p.amount : null,
        p.currency,
      ])
    }
  }
  return rows
}

export const TRIAL_BALANCE_HEADER = ['Code', 'Account', 'Type', 'Debit', 'Credit']

/** A trial balance as rows — the tax-basis one in the package is this over the spliced books. */
export function trialBalanceRows(tb: { rows: { code: string; name: string; type: string; debit: number; credit: number }[]; totalDebits: number; totalCredits: number }): Cell[][] {
  const rows: Cell[][] = [TRIAL_BALANCE_HEADER]
  for (const r of tb.rows) rows.push([r.code, r.name, r.type, r.debit || null, r.credit || null])
  rows.push(['', 'Totals', '', tb.totalDebits, tb.totalCredits])
  return rows
}

export const QUICKBOOKS_HEADER = ['Date', 'Transaction Type', 'Num', 'Name', 'Memo/Description', 'Account', 'Debit', 'Credit']

/**
 * QuickBooks' Journal report layout. Every entry is a "Journal Entry"; Num is the entry
 * reference (the id's prefix when there is none); Name is the payee. Debits and credits
 * are positive magnitudes in two columns, blank where zero.
 */
export function quickbooksJournalRows(entries: ExportEntry[]): Cell[][] {
  const rows: Cell[][] = [QUICKBOOKS_HEADER]
  for (const e of sortEntries(entries)) {
    e.postings.forEach((p, i) => {
      rows.push([
        i === 0 ? e.entryDate : '',
        i === 0 ? 'Journal Entry' : '',
        i === 0 ? (e.reference || entryRef(e.id)) : '',
        e.vendorName ?? '',
        e.memo ?? '',
        accountLabel(p),
        p.amount > 0 ? p.amount : null,
        p.amount < 0 ? -p.amount : null,
      ])
    })
  }
  return rows
}

export const CHART_HEADER = ['Code', 'Account', 'Type', 'Subtype', 'Normal side', 'Active', 'Partner', 'Company']

export interface ChartExportAccount extends Account {
  isActive?: boolean | null
}

export function chartRows(accounts: ChartExportAccount[]): Cell[][] {
  const rows: Cell[][] = [CHART_HEADER]
  for (const a of [...accounts].sort((x, y) => x.code.localeCompare(y.code))) {
    rows.push([
      a.code, a.name, a.type, a.subtype ?? '', NORMAL_SIDE[a.type],
      a.isActive === false ? 'no' : 'yes',
      a.lpEntityId ?? '', a.companyId ?? '',
    ])
  }
  return rows
}

export const GENERAL_LEDGER_HEADER = ['Account', 'Account name', 'Date', 'Entry', 'Source', 'Memo', 'Against', 'Debit', 'Credit', 'Balance']

/**
 * Every account's register in one table. An account with neither an opening balance nor
 * activity in the window is left out; one with a balance and no activity still appears, because
 * a balance-sheet account that did nothing all year is still on the general ledger.
 */
export function generalLedgerRows(
  accounts: Account[],
  postings: RegisterPosting[],
  period: { start?: string | null; end?: string | null },
): Cell[][] {
  const byId = new Map(accounts.map(a => [a.id, a]))
  const rows: Cell[][] = [GENERAL_LEDGER_HEADER]
  for (const acct of [...accounts].sort((x, y) => x.code.localeCompare(y.code))) {
    const reg = accountRegister(acct, postings, byId, period)
    if (reg.opening === 0 && reg.lines.length === 0) continue
    rows.push([acct.code, acct.name, period.start ?? '', '', '', 'Opening balance', '', null, null, reg.opening])
    for (const l of reg.lines) {
      rows.push([
        acct.code, acct.name, l.entryDate ?? '', entryRef(l.entryId), l.sourceType ?? '', l.memo ?? '',
        l.counterAccounts.map(c => c.code).join(' '),
        l.debit || null, l.credit || null, l.running,
      ])
    }
    rows.push([acct.code, acct.name, period.end ?? '', '', '', 'Closing balance', '', reg.totals.debit, reg.totals.credit, reg.closing])
  }
  return rows
}
