import { splitLine, pickDelim, normalizeDate, parseAmount } from '@/lib/accounting/bank'

/**
 * QuickBooks' Journal report, parsed. Pure.
 *
 * WHY THE JOURNAL REPORT and not the General Ledger or the Trial Balance. The Journal is the
 * only QuickBooks export that is already a double-entry stream — one row per split line, with
 * both sides of every transaction present. The GL report is account-major and loses the
 * transaction grouping (you cannot tell which credit answers which debit); the Trial Balance
 * has no detail at all. We import the Trial Balance too, but only as the tie-out target.
 *
 * THE GROUPING RULE. QuickBooks prints date/type/num on a transaction's FIRST line only and
 * leaves them blank on its continuation lines. A row with a date starts a new transaction; a
 * row without one belongs to the transaction above it. Get this wrong and unrelated
 * transactions merge into one entry that happens to balance.
 */

export interface QbLine {
  account: string
  name: string | null
  memo: string | null
  /** Positive magnitudes, as QuickBooks prints them. Conversion to signed happens later. */
  debit: number
  credit: number
}

export interface QbTransaction {
  date: string
  type: string | null
  num: string | null
  memo: string | null
  lines: QbLine[]
}

export interface QbAccountSummary {
  account: string
  lineCount: number
  totalDebit: number
  totalCredit: number
}

/**
 * Split into records WITHOUT trimming leading delimiters.
 *
 * Not `splitRecords` from bank.ts: that one ends with `.map(r => r.trim())`, which is harmless
 * for CSV but destroys a TAB-delimited continuation line — QuickBooks writes those with empty
 * leading columns (`\t\t\t\tMemo\tAccount...`), and trimming the leading tabs shifts every
 * column left, so the account lands where the memo should be. Only line endings are stripped.
 */
function splitJournalRecords(text: string): string[] {
  const records: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') { cur += '""'; i++; continue }
      inQuotes = !inQuotes
      cur += c
    } else if ((c === '\n' || c === '\r') && !inQuotes) {
      if (c === '\r' && text[i + 1] === '\n') i++
      records.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  records.push(cur)
  // Strip stray carriage returns only — never leading/trailing delimiters.
  return records.map(r => r.replace(/\r/g, '')).filter(r => r.length > 0)
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

const HEADERS = {
  date:    ['date', 'transaction date'],
  type:    ['transaction type', 'type'],
  num:     ['num', 'number', 'no.', 'ref no.', 'ref'],
  name:    ['name', 'payee', 'vendor'],
  memo:    ['memo/description', 'memo', 'description'],
  account: ['account', 'account name', 'split'],
  debit:   ['debit', 'debits'],
  credit:  ['credit', 'credits'],
}

const TOTAL_ROW = /^(total|totals|grand total|beginning balance|ending balance)\b/i
const CENT = 0.005

export function parseQbJournal(text: string): {
  transactions: QbTransaction[]
  accounts: QbAccountSummary[]
  errors: string[]
} {
  const errors: string[] = []
  const records = splitJournalRecords(text).filter(l => l.trim().length > 0)
  if (records.length < 2) return { transactions: [], accounts: [], errors: ['Nothing to parse.'] }

  const delim = pickDelim(records[0])
  const header = splitLine(records[0], delim).map(norm)
  const col = (k: keyof typeof HEADERS) => header.findIndex(h => HEADERS[k].includes(h))
  const idx = {
    date: col('date'), type: col('type'), num: col('num'), name: col('name'),
    memo: col('memo'), account: col('account'), debit: col('debit'), credit: col('credit'),
  }

  const missing = (['account', 'debit', 'credit'] as const).filter(k => idx[k] < 0)
  if (missing.length > 0) {
    return { transactions: [], accounts: [], errors: [`Missing required column(s): ${missing.join(', ')}. Export the Journal report with Debit and Credit columns.`] }
  }
  if (idx.date < 0) {
    return { transactions: [], accounts: [], errors: ['Missing a Date column.'] }
  }

  const cell = (cells: string[], i: number) => (i >= 0 ? (cells[i] ?? '').trim() : '')
  const money = (raw: string) => (raw ? (parseAmount(raw) ?? 0) : 0)

  const out: QbTransaction[] = []
  let current: QbTransaction | null = null

  for (const rec of records.slice(1)) {
    const cells = splitLine(rec, delim)
    const account = cell(cells, idx.account)
    if (!account || TOTAL_ROW.test(account)) continue

    const dateRaw = cell(cells, idx.date)
    if (dateRaw) {
      const date = normalizeDate(dateRaw)
      if (!date) { errors.push(`Unreadable date "${dateRaw}".`); current = null; continue }
      current = {
        date,
        type: cell(cells, idx.type) || null,
        num: cell(cells, idx.num) || null,
        memo: cell(cells, idx.memo) || null,
        lines: [],
      }
      out.push(current)
    }

    // A split line before any dated row is orphaned — report it rather than attaching it
    // to whatever came before.
    if (!current) { errors.push(`Line for "${account}" has no transaction date above it.`); continue }

    current.lines.push({
      account,
      name: cell(cells, idx.name) || null,
      memo: cell(cells, idx.memo) || null,
      debit: Math.abs(money(cell(cells, idx.debit))),
      credit: Math.abs(money(cell(cells, idx.credit))),
    })
  }

  // Drop anything that does not balance. An unbalanced transaction is a broken export or a
  // parse error, and importing it would fail assertBalanced in persistEntry anyway — better
  // to name it here, where the user can see which one.
  const balanced: QbTransaction[] = []
  for (const t of out) {
    if (t.lines.length === 0) continue
    const diff = t.lines.reduce((a, l) => a + l.debit - l.credit, 0)
    if (Math.abs(diff) > CENT) {
      errors.push(`${t.type ?? 'Transaction'} ${t.num ?? t.date} does not balance (off by ${diff.toFixed(2)}).`)
      continue
    }
    balanced.push(t)
  }

  const summary = new Map<string, QbAccountSummary>()
  for (const t of balanced) {
    for (const l of t.lines) {
      const s = summary.get(l.account) ?? { account: l.account, lineCount: 0, totalDebit: 0, totalCredit: 0 }
      s.lineCount += 1
      s.totalDebit += l.debit
      s.totalCredit += l.credit
      summary.set(l.account, s)
    }
  }

  return {
    transactions: balanced,
    // Busiest accounts first — the mapping screen should open on what matters.
    accounts: Array.from(summary.values()).sort((a, b) => b.lineCount - a.lineCount),
    errors,
  }
}
