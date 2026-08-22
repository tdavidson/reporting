import { exportFile } from '@/lib/google/drive'
import type { PriceFeed } from '../quotes'
import type { QuoteProvider, QuoteResult, ProviderContext } from './types'

// ---------------------------------------------------------------------------
// Google Finance, via a Google Sheet.
//
// THERE IS NO GOOGLE FINANCE API. Google retired it in 2012, and the only sanctioned access to
// that data is the GOOGLEFINANCE() formula inside Sheets. So the fund keeps a sheet whose cells
// are GOOGLEFINANCE formulas and we read the COMPUTED VALUES back out of it.
//
// Read via the Drive export endpoint as text/csv rather than the Sheets API, and that is the
// whole reason this provider is cheap here: the fund's existing Google connection already has
// `drive.readonly`, so nothing has to be re-consented. Using the Sheets API would need the
// `spreadsheets` scope and force every fund through the OAuth screen again.
//
// WHAT THIS PROVIDER CANNOT DO, stated plainly because the gap is invisible until it bites:
//   - No corporate actions. GOOGLEFINANCE reports no splits, so a split must be entered by
//     hand as a `split` transaction. That is exactly what the split action exists for, and
//     it is the one piece a paid vendor would automate.
//   - Google's terms describe this data as informational and not for trading purposes. Marking
//     a fund's NAV off it is a licensing judgement for the fund to make, not a technical one.
//   - The sheet lives in someone's Drive. Anyone with edit access can change a cell that
//     becomes a position's carrying value, and nothing here can tell an edited cell from a
//     computed one. `price_observations.source` records that a figure came from this route so
//     the provenance is at least on the record.
// ---------------------------------------------------------------------------

/** The columns the sheet must have, by header name. Order does not matter; case does not either. */
const COLUMNS = ['symbol', 'as_of', 'price'] as const

export interface SheetQuoteRow {
  symbol: string
  asOfDate: string
  price: number
  basis: 'close' | 'intraday' | 'indicative'
}

/**
 * Minimal CSV reader — quoted fields, escaped quotes, embedded commas and newlines.
 *
 * Hand-rolled rather than a dependency because the input is one small machine-generated sheet,
 * and because a split(',') would corrupt exactly the rows that matter: Sheets quotes any cell
 * containing a comma, and a price rendered as "1,234.56" in a locale that groups thousands
 * would silently parse as 1.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += c
      continue
    }
    if (c === '"') { quoted = true; continue }
    if (c === ',') { row.push(field); field = ''; continue }
    if (c === '\r') continue
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += c
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

/** A number as Sheets may render it: thousands separators, a currency symbol, parenthesised. */
export function parseNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$£€\s,]/g, '')
  if (!cleaned) return null
  const negated = /^\((.*)\)$/.exec(cleaned)
  const n = Number(negated ? `-${negated[1]}` : cleaned)
  return Number.isFinite(n) ? n : null
}

/**
 * A date as Sheets may render it. ISO passes through; the US M/D/YYYY that a default-locale
 * sheet emits is converted. Anything else is REFUSED rather than guessed at: 03/04/2026 is
 * ambiguous across locales, and a mark landing in the wrong month prices the wrong period.
 */
export function parseSheetDate(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  // Sheets often renders a date cell as "2026-03-31" or "2026-03-31 16:00:00".
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)
  if (us) {
    const [, m, d, y] = us
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return null
}

/**
 * Turn an exported sheet into quote rows.
 *
 * Header-driven rather than positional, so a fund can add its own columns (a name, a note, a
 * check formula) without breaking the read. A row missing a required cell, or carrying an
 * unparseable price or date, is DROPPED — never defaulted. The close then blocks on the
 * missing quote, which is the outcome we want: a loud gap beats a quiet wrong number.
 */
export function parseQuoteSheet(csv: string): { rows: SheetQuoteRow[]; problems: string[] } {
  const table = parseCsv(csv).filter(r => r.some(c => c.trim() !== ''))
  const problems: string[] = []
  if (table.length === 0) return { rows: [], problems: ['The sheet is empty.'] }

  const header = table[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const idx = Object.fromEntries(COLUMNS.map(c => [c, header.indexOf(c)])) as Record<string, number>
  const missing = COLUMNS.filter(c => idx[c] < 0)
  if (missing.length > 0) {
    return {
      rows: [],
      problems: [`The sheet needs a header row with these columns: ${COLUMNS.join(', ')}. Missing: ${missing.join(', ')}.`],
    }
  }
  const basisIdx = header.indexOf('basis')

  const rows: SheetQuoteRow[] = []
  for (let i = 1; i < table.length; i++) {
    const cells = table[i]
    const symbol = (cells[idx.symbol] ?? '').trim()
    if (!symbol) continue

    const price = parseNumber(cells[idx.price] ?? '')
    if (price == null || price < 0) {
      // A GOOGLEFINANCE cell that has not resolved renders as #N/A — a real and common state
      // for a delisted or mistyped ticker, worth naming rather than silently skipping.
      problems.push(`${symbol}: could not read a price from "${(cells[idx.price] ?? '').trim()}".`)
      continue
    }
    const asOfDate = parseSheetDate(cells[idx.as_of] ?? '')
    if (!asOfDate) {
      problems.push(`${symbol}: could not read a date from "${(cells[idx.as_of] ?? '').trim()}" — use YYYY-MM-DD.`)
      continue
    }

    // Default 'intraday', NOT 'close'. GOOGLEFINANCE's bare price attribute is a delayed live
    // quote, and calling that an official close would claim Level 1 for a Level 2 mark. The
    // recommended template uses the historical `close` attribute and declares basis=close.
    const declared = (cells[basisIdx] ?? '').trim().toLowerCase()
    const basis = declared === 'close' || declared === 'indicative' ? declared : 'intraday'

    rows.push({ symbol, asOfDate, price, basis })
  }
  return { rows, problems }
}

/**
 * How a feed is named in the sheet: GOOGLEFINANCE's own "EXCHANGE:TICKER" form where an
 * exchange is known, and the bare ticker otherwise. Matched case-insensitively, and a bare
 * ticker in the sheet still matches a feed that carries an exchange — funds write the short
 * form constantly and failing to price a position over punctuation helps nobody.
 */
export function sheetKeysFor(feed: PriceFeed): string[] {
  const bare = feed.symbol.trim().toUpperCase()
  const keys = [bare]
  if (feed.exchange) keys.unshift(`${feed.exchange.trim().toUpperCase()}:${bare}`)
  if (bare.includes(':')) keys.push(bare.split(':').pop()!.trim())
  return keys
}

export const googleSheetsProvider: QuoteProvider = {
  name: 'google_sheets',

  async fetch(feeds: PriceFeed[], ctx: ProviderContext): Promise<Map<string, QuoteResult>> {
    const out = new Map<string, QuoteResult>()
    if (feeds.length === 0) return out
    if (!ctx.quoteSheetFileId) return out

    const token = ctx.accessToken ? await ctx.accessToken() : null
    if (!token) return out

    const buf = await exportFile(token, ctx.quoteSheetFileId, 'text/csv')
    const { rows } = parseQuoteSheet(buf.toString('utf8'))

    // Last row wins per symbol, so a sheet listing a symbol twice behaves predictably rather
    // than depending on which lookup happened first.
    const bySymbol = new Map<string, SheetQuoteRow>()
    for (const r of rows) bySymbol.set(r.symbol.trim().toUpperCase(), r)

    for (const feed of feeds) {
      for (const key of sheetKeysFor(feed)) {
        const hit = bySymbol.get(key)
        if (hit) {
          out.set(feed.id, { price: hit.price, asOfDate: hit.asOfDate, basis: hit.basis })
          break
        }
      }
    }
    return out
  },
}

/**
 * The formula template shown in the UI, as a CSV block a fund can paste straight into a sheet.
 *
 * It reads the HISTORICAL close over a trailing window and takes the last row, which returns
 * the most recent TRADING DAY's official close together with its real date. That handles
 * weekends and holidays natively — the same reason `quoteAsOf` looks backwards from period end
 * rather than demanding a price stamped exactly on it — and it earns basis=close honestly,
 * where GOOGLEFINANCE's bare price attribute would not.
 */
export const SHEET_TEMPLATE = [
  'symbol,as_of,price,basis',
  '"NASDAQ:AAPL","=INDEX(GOOGLEFINANCE($A2,""close"",TODAY()-10,TODAY()),ROWS(GOOGLEFINANCE($A2,""close"",TODAY()-10,TODAY())),1)","=INDEX(GOOGLEFINANCE($A2,""close"",TODAY()-10,TODAY()),ROWS(GOOGLEFINANCE($A2,""close"",TODAY()-10,TODAY())),2)",close',
].join('\n')
