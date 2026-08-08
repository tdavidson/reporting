import { describe, it, expect } from 'vitest'
import { parseFofPaste, matchHoldings } from './fof-paste'

const HOLDINGS = [
  { id: 'f1', name: 'Acme Ventures III', aliases: ['Acme III'] },
  { id: 'f2', name: 'Beta Growth Fund II', aliases: null },
]

describe('parseFofPaste', () => {
  it('parses a tab-separated paste with a header row', () => {
    const text = [
      'Fund\tNAV as of\tReported NAV\tCalls\tDistributions',
      'Acme Ventures III\t2025-09-30\t4,000,000\t500,000\t0',
      'Beta Growth Fund II\t9/30/2025\t2,250,000\t0\t150,000',
    ].join('\n')
    const { rows, errors } = parseFofPaste(text)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      fundName: 'Acme Ventures III', navAsOf: '2025-09-30',
      reportedNav: 4_000_000, calls: 500_000, distributions: 0,
    })
    // Both date formats normalize through the shared normalizeDate.
    expect(rows[1].navAsOf).toBe('2025-09-30')
    expect(rows[1].distributions).toBe(150_000)
  })

  it('accepts CSV and headers in any order or casing', () => {
    const text = [
      'reported nav,fund,calls,distributions,nav as of',
      '"1,000,000",Acme Ventures III,0,0,2025-06-30',
    ].join('\n')
    const { rows, errors } = parseFofPaste(text)
    expect(errors).toEqual([])
    expect(rows[0].fundName).toBe('Acme Ventures III')
    expect(rows[0].reportedNav).toBe(1_000_000)
    expect(rows[0].navAsOf).toBe('2025-06-30')
  })

  it('treats blank money cells as zero but a blank NAV as absent', () => {
    // A blank call column means "no call this quarter". A blank NAV means the manager has
    // not reported — which is NOT the same as a NAV of zero, and must never become one.
    const text = 'Fund\tNAV as of\tReported NAV\tCalls\tDistributions\nAcme Ventures III\t\t\t\t'
    const { rows } = parseFofPaste(text)
    expect(rows[0].calls).toBe(0)
    expect(rows[0].distributions).toBe(0)
    expect(rows[0].reportedNav).toBeNull()
    expect(rows[0].navAsOf).toBeNull()
  })

  it('reports a missing required header instead of guessing', () => {
    const { rows, errors } = parseFofPaste('Reported NAV\tCalls\n4000000\t0')
    expect(rows).toEqual([])
    expect(errors.join(' ')).toMatch(/fund/i)
  })

  it('skips blank lines and a totals row', () => {
    const text = [
      'Fund\tNAV as of\tReported NAV\tCalls\tDistributions',
      'Acme Ventures III\t2025-09-30\t4000000\t0\t0',
      '',
      'Total\t\t4000000\t0\t0',
    ].join('\n')
    const { rows } = parseFofPaste(text)
    expect(rows.map(r => r.fundName)).toEqual(['Acme Ventures III'])
  })

  it('flags a row whose NAV will not parse rather than dropping it', () => {
    const text = 'Fund\tNAV as of\tReported NAV\tCalls\tDistributions\nAcme Ventures III\t2025-09-30\tsee note\t0\t0'
    const { rows, errors } = parseFofPaste(text)
    expect(rows).toHaveLength(0)
    expect(errors.join(' ')).toMatch(/Acme Ventures III/)
  })

  it('flags an unreadable date rather than silently dropping the NAV', () => {
    // A NAV with no valuation date cannot be placed in time, and a silently-null as-of date
    // would make the position look unreported rather than mis-typed.
    const text = 'Fund\tNAV as of\tReported NAV\tCalls\tDistributions\nAcme Ventures III\tQ3\t4000000\t0\t0'
    const { rows, errors } = parseFofPaste(text)
    expect(rows).toHaveLength(0)
    expect(errors.join(' ')).toMatch(/Q3|date/i)
  })
})

describe('matchHoldings', () => {
  const rows = parseFofPaste([
    'Fund\tNAV as of\tReported NAV\tCalls\tDistributions',
    'Acme Ventures III\t2025-09-30\t4000000\t0\t0',
    'acme  iii\t2025-09-30\t4000000\t0\t0',
    'Gamma Partners\t2025-09-30\t100\t0\t0',
  ].join('\n')).rows

  it('matches on exact name, case- and whitespace-insensitively', () => {
    const m = matchHoldings([rows[0]], HOLDINGS)
    expect(m[0].companyId).toBe('f1')
  })

  it('matches on an alias', () => {
    const m = matchHoldings([rows[1]], HOLDINGS)
    expect(m[0].companyId).toBe('f1')
    expect(m[0].matchedName).toBe('Acme Ventures III')
  })

  it('leaves an unknown fund unmatched rather than guessing', () => {
    // 20+ managers with similar names — a wrong fuzzy match silently books a call against
    // the wrong position. Unmatched is a review item; mismatched is a restatement.
    const m = matchHoldings([rows[2]], HOLDINGS)
    expect(m[0].companyId).toBeNull()
    expect(m[0].matchedName).toBeNull()
  })

  it('returns one result per input row, in order', () => {
    const m = matchHoldings(rows, HOLDINGS)
    expect(m).toHaveLength(3)
    expect(m.map(r => r.companyId)).toEqual(['f1', 'f1', null])
  })
})
