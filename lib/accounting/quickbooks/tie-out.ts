import { splitLine, pickDelim, parseAmount } from '@/lib/accounting/bank'
import type { TrialBalance } from '@/lib/accounting/statements'

/**
 * The migration's acceptance test: our trial balance against QuickBooks', account by account.
 *
 * Migration is done when every period ties — not when the import runs without errors. That is
 * the whole reason the Trial Balance is imported separately from the Journal: the Journal is
 * what we load, the Trial Balance is what we prove it against.
 */

export interface QbTrialBalanceRow {
  account: string
  debit: number
  credit: number
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
const TOTAL_ROW = /^(total|totals|grand total)\b/i
const CENT = 0.005

const HEADERS = {
  account: ['account', 'account name', 'name'],
  debit: ['debit', 'debits'],
  credit: ['credit', 'credits'],
}

export function parseQbTrialBalance(text: string): { rows: QbTrialBalanceRow[]; errors: string[] } {
  // Records split on newlines only; a trial balance has no leading empty columns to protect,
  // but quoted amounts still need the quote-aware line splitter.
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length < 2) return { rows: [], errors: ['Nothing to parse.'] }

  const delim = pickDelim(lines[0])
  const header = splitLine(lines[0], delim).map(norm)
  const col = (k: keyof typeof HEADERS) => header.findIndex(h => HEADERS[k].includes(h))
  const idx = { account: col('account'), debit: col('debit'), credit: col('credit') }

  const missing = (['account', 'debit', 'credit'] as const).filter(k => idx[k] < 0)
  if (missing.length > 0) {
    return { rows: [], errors: [`Missing required column(s): ${missing.join(', ')}.`] }
  }

  const rows: QbTrialBalanceRow[] = []
  for (const line of lines.slice(1)) {
    const cells = splitLine(line, delim)
    const account = (cells[idx.account] ?? '').trim()
    if (!account || TOTAL_ROW.test(account)) continue
    const money = (i: number) => {
      const raw = (cells[i] ?? '').trim()
      return raw ? Math.abs(parseAmount(raw) ?? 0) : 0
    }
    rows.push({ account, debit: money(idx.debit), credit: money(idx.credit) })
  }

  return { rows, errors: [] }
}

export interface TieOutLine {
  code: string
  name: string
  ours: number
  theirs: number
  /** ours − theirs. */
  difference: number
}

export function compareTrialBalance(
  ours: TrialBalance,
  theirs: QbTrialBalanceRow[],
  mapping: Map<string, string>,
): { lines: TieOutLine[]; ties: boolean; ourTotal: number; theirTotal: number } {
  // Several QuickBooks accounts can map to one of ours — sum them before comparing.
  //
  // Unmapped QuickBooks accounts are SKIPPED, not reported as differences. An unmapped
  // account is a mapping-screen problem; surfacing it here would bury the real differences
  // under noise. The mapping screen shows coverage separately.
  const theirsByCode = new Map<string, number>()
  for (const r of theirs) {
    const code = mapping.get(r.account)
    if (!code) continue
    theirsByCode.set(code, round2((theirsByCode.get(code) ?? 0) + r.debit - r.credit))
  }

  const oursByCode = new Map<string, { name: string; balance: number }>()
  for (const r of (ours.rows as unknown as { code: string; name: string; balance: number }[])) {
    oursByCode.set(r.code, { name: r.name, balance: r.balance })
  }

  const codes = new Set([...Array.from(oursByCode.keys()), ...Array.from(theirsByCode.keys())])
  const lines: TieOutLine[] = []
  for (const code of Array.from(codes).sort()) {
    const o = oursByCode.get(code)?.balance ?? 0
    const t = theirsByCode.get(code) ?? 0
    const difference = round2(o - t)
    if (Math.abs(difference) < CENT) continue
    lines.push({ code, name: oursByCode.get(code)?.name ?? '(not in our chart)', ours: o, theirs: t, difference })
  }

  return {
    lines,
    ties: lines.length === 0,
    ourTotal: round2(sum(Array.from(oursByCode.values()).map(v => v.balance))),
    theirTotal: round2(sum(Array.from(theirsByCode.values()))),
  }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const round2 = (n: number) => Math.round(n * 100) / 100
