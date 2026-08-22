import { describe, it, expect } from 'vitest'
import { parseCsv, parseNumber, parseSheetDate, parseQuoteSheet, sheetKeysFor } from './google-sheets'
import type { PriceFeed } from '../quotes'

const feed = (o: Partial<PriceFeed> = {}): PriceFeed => ({
  id: 'f1', companyId: 'c1', kind: 'listed_equity', symbol: 'AAPL',
  exchange: 'NASDAQ', quoteCurrency: 'USD', quoteScale: 1,
  activeFrom: '2026-01-01', activeUntil: null,
  restrictionUntil: null, restrictionDiscount: null,
  ...o,
})

describe('parseCsv', () => {
  it('reads quoted fields containing commas', () => {
    expect(parseCsv('a,"b,c",d')).toEqual([['a', 'b,c', 'd']])
  })

  it('reads escaped quotes', () => {
    expect(parseCsv('"say ""hi""",x')).toEqual([['say "hi"', 'x']])
  })

  it('reads a newline inside a quoted field', () => {
    expect(parseCsv('"line1\nline2",x')).toEqual([['line1\nline2', 'x']])
  })

  it('handles CRLF and a missing trailing newline', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']])
  })
})

describe('parseNumber', () => {
  it('reads a plain number', () => {
    expect(parseNumber('25.5')).toBe(25.5)
  })

  it('reads a grouped, symbolled figure as Sheets renders it', () => {
    // The bug this prevents: split(',') on "1,234.56" parses as 1 and marks the position
    // at a thousandth of its value.
    expect(parseNumber('$1,234.56')).toBe(1234.56)
    expect(parseNumber('£4,000')).toBe(4000)
  })

  it('reads a parenthesised negative', () => {
    expect(parseNumber('(12.5)')).toBe(-12.5)
  })

  it('refuses an unresolved formula cell', () => {
    expect(parseNumber('#N/A')).toBeNull()
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('  ')).toBeNull()
  })
})

describe('parseSheetDate', () => {
  it('passes ISO through, with or without a time', () => {
    expect(parseSheetDate('2026-03-31')).toBe('2026-03-31')
    expect(parseSheetDate('2026-03-31 16:00:00')).toBe('2026-03-31')
  })

  it('converts the US rendering a default-locale sheet emits', () => {
    expect(parseSheetDate('3/31/2026')).toBe('2026-03-31')
    expect(parseSheetDate('12/1/2026')).toBe('2026-12-01')
  })

  it('refuses anything else rather than guessing the month', () => {
    // 03-04-2026 is March or April depending on locale, and a mark in the wrong month
    // prices the wrong period.
    expect(parseSheetDate('03-04-2026')).toBeNull()
    expect(parseSheetDate('31 March 2026')).toBeNull()
    expect(parseSheetDate('')).toBeNull()
  })
})

describe('parseQuoteSheet', () => {
  const header = 'symbol,as_of,price,basis'

  it('reads the recommended template shape', () => {
    const { rows, problems } = parseQuoteSheet(
      `${header}\nNASDAQ:AAPL,2026-03-31,"$1,234.56",close`,
    )
    expect(problems).toEqual([])
    expect(rows).toEqual([
      { symbol: 'NASDAQ:AAPL', asOfDate: '2026-03-31', price: 1234.56, basis: 'close' },
    ])
  })

  it('defaults an undeclared basis to intraday, not close', () => {
    // GOOGLEFINANCE's bare price attribute is a delayed live quote. Calling it a close would
    // claim Level 1 for a Level 2 mark.
    const { rows } = parseQuoteSheet('symbol,as_of,price\nAAPL,2026-03-31,25')
    expect(rows[0].basis).toBe('intraday')
  })

  it('tolerates extra columns and odd header casing', () => {
    const { rows, problems } = parseQuoteSheet(
      'Name,SYMBOL,As Of,Price,Note\nApple,AAPL,2026-03-31,25,checked',
    )
    expect(problems).toEqual([])
    expect(rows[0]).toMatchObject({ symbol: 'AAPL', price: 25 })
  })

  it('names the missing columns rather than returning nothing silently', () => {
    const { rows, problems } = parseQuoteSheet('symbol,price\nAAPL,25')
    expect(rows).toEqual([])
    expect(problems[0]).toContain('as_of')
  })

  it('drops an unresolved row and says which symbol it was', () => {
    const { rows, problems } = parseQuoteSheet(
      `${header}\nAAPL,2026-03-31,25,close\nDELISTED,2026-03-31,#N/A,close`,
    )
    expect(rows).toHaveLength(1)
    expect(problems[0]).toContain('DELISTED')
  })

  it('drops a row whose date it cannot read unambiguously', () => {
    const { rows, problems } = parseQuoteSheet(`${header}\nAAPL,03-04-2026,25,close`)
    expect(rows).toEqual([])
    expect(problems[0]).toContain('YYYY-MM-DD')
  })

  it('ignores blank rows a sheet pads itself with', () => {
    const { rows } = parseQuoteSheet(`${header}\nAAPL,2026-03-31,25,close\n,,,\n,,,`)
    expect(rows).toHaveLength(1)
  })

  it('reports an empty sheet', () => {
    expect(parseQuoteSheet('').problems[0]).toContain('empty')
  })
})

describe('sheetKeysFor', () => {
  it('prefers the EXCHANGE:TICKER form GOOGLEFINANCE uses', () => {
    expect(sheetKeysFor(feed())).toEqual(['NASDAQ:AAPL', 'AAPL'])
  })

  it('still matches a bare ticker when the feed carries an exchange', () => {
    // Funds write the short form constantly; refusing to price over punctuation helps nobody.
    expect(sheetKeysFor(feed())).toContain('AAPL')
  })

  it('handles a feed whose symbol already carries the exchange', () => {
    expect(sheetKeysFor(feed({ symbol: 'XLON:VOD', exchange: null }))).toEqual(['XLON:VOD', 'VOD'])
  })
})
