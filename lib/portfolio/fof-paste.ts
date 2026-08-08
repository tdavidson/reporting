import { splitRecords, splitLine, pickDelim, normalizeDate, parseAmount } from '@/lib/accounting/bank'

/**
 * The quarterly grid's paste path: the CFO's spreadsheet, one row per underlying fund.
 *
 * Pure, and split into parse-then-match on purpose. With 20+ managers whose names rhyme
 * ("Acme Ventures III" vs "Acme Growth III"), a fuzzy match that guesses wrong books a call
 * against the wrong position and is only caught at the next manager tie-out. So matching is
 * exact-or-alias only: an unmatched row is a review item, which is cheap. A mismatched row is
 * a restatement, which is not.
 */

export interface GridInputRow {
  fundName: string
  /** null = the manager has not reported. NOT the same as a NAV of zero. */
  navAsOf: string | null
  reportedNav: number | null
  calls: number
  distributions: number
}

export interface MatchedRow {
  row: GridInputRow
  companyId: string | null
  matchedName: string | null
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

// Header synonyms. Add to these rather than teaching the parser to guess by position.
const HEADERS: Record<keyof GridInputRow, string[]> = {
  fundName:      ['fund', 'fund name', 'name', 'investment', 'holding'],
  navAsOf:       ['nav as of', 'as of', 'as of date', 'nav date', 'valuation date'],
  reportedNav:   ['reported nav', 'nav', 'fair value', 'value', 'ending nav'],
  calls:         ['calls', 'call', 'contributions', 'capital called', 'called'],
  distributions: ['distributions', 'distribution', 'dists', 'distributed'],
}

const TOTAL_ROW = /^(total|totals|sum|grand total)$/i

export function parseFofPaste(text: string): { rows: GridInputRow[]; errors: string[] } {
  const errors: string[] = []
  const records = splitRecords(text).filter(l => l.trim().length > 0)
  if (records.length < 2) return { rows: [], errors: ['Paste a header row and at least one fund.'] }

  const delim = pickDelim(records[0])
  const header = splitLine(records[0], delim).map(norm)

  const col = (k: keyof GridInputRow) => header.findIndex(h => HEADERS[k].includes(h))
  const idx = {
    fundName: col('fundName'),
    navAsOf: col('navAsOf'),
    reportedNav: col('reportedNav'),
    calls: col('calls'),
    distributions: col('distributions'),
  }

  if (idx.fundName < 0) {
    return { rows: [], errors: ['No "Fund" column found. Expected a header naming the fund.'] }
  }

  const rows: GridInputRow[] = []
  for (const rec of records.slice(1)) {
    const cells = splitLine(rec, delim)
    const fundName = (cells[idx.fundName] ?? '').trim()
    if (!fundName || TOTAL_ROW.test(fundName)) continue

    const cell = (i: number) => (i >= 0 ? (cells[i] ?? '').trim() : '')

    // A blank money cell is zero — "no call this quarter" is the common case and typing 0
    // into twenty rows is how a real one gets missed.
    const money = (raw: string, label: string): number | null => {
      if (!raw) return 0
      const n = parseAmount(raw)
      if (n === null) { errors.push(`${fundName}: could not read ${label} "${raw}".`); return null }
      return n
    }

    const navRaw = cell(idx.reportedNav)
    let reportedNav: number | null = null
    if (navRaw) {
      const n = parseAmount(navRaw)
      if (n === null) { errors.push(`${fundName}: could not read reported NAV "${navRaw}".`); continue }
      reportedNav = n
    }

    // An unreadable valuation date is an error, not an absent NAV: silently nulling it would
    // make a mis-typed row look like a fund that simply has not reported.
    const asOfRaw = cell(idx.navAsOf)
    let navAsOf: string | null = null
    if (asOfRaw) {
      navAsOf = normalizeDate(asOfRaw)
      if (!navAsOf) { errors.push(`${fundName}: could not read the NAV date "${asOfRaw}".`); continue }
    }

    const calls = money(cell(idx.calls), 'calls')
    const distributions = money(cell(idx.distributions), 'distributions')
    if (calls === null || distributions === null) continue

    rows.push({ fundName, navAsOf, reportedNav, calls, distributions })
  }

  return { rows, errors }
}

export function matchHoldings(
  rows: GridInputRow[],
  holdings: { id: string; name: string; aliases?: string[] | null }[],
): MatchedRow[] {
  const byName = new Map<string, { id: string; name: string }>()
  for (const h of holdings) {
    byName.set(norm(h.name), { id: h.id, name: h.name })
    for (const a of h.aliases ?? []) byName.set(norm(a), { id: h.id, name: h.name })
  }
  return rows.map(row => {
    const hit = byName.get(norm(row.fundName)) ?? null
    return { row, companyId: hit?.id ?? null, matchedName: hit?.name ?? null }
  })
}
