import { describe, it, expect } from 'vitest'
import { resolveDistributionSplit } from './bank-match'
import {
  parseTransactionsCsv,
  normalizeDate,
  dedupHash,
  suggestCategory,
  bankEntryPostings,
  summarizeBankRec,
} from './bank'
import { isBalanced } from './ledger'

describe('normalizeDate', () => {
  it('accepts ISO and M/D/Y', () => {
    expect(normalizeDate('2026-06-30')).toBe('2026-06-30')
    expect(normalizeDate('6/30/2026')).toBe('2026-06-30')
    expect(normalizeDate('06/05/26')).toBe('2026-06-05')
    expect(normalizeDate('nope')).toBeNull()
  })
})

describe('parseTransactionsCsv', () => {
  it('parses a signed-amount CSV', () => {
    const csv = 'Date,Description,Amount\n2026-06-01,Capital call Fund II,5000000\n2026-06-15,Audit fee,-12000'
    const { rows, errors } = parseTransactionsCsv(csv)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ date: '2026-06-01', amount: 5000000, description: 'Capital call Fund II' })
    expect(rows[1].amount).toBe(-12000)
  })

  it('parses debit/credit columns and TSV', () => {
    const tsv = 'Date\tDescription\tDebit\tCredit\n06/15/2026\tWire in\t\t5000000\n06/20/2026\tLegal\t3000\t'
    const { rows } = parseTransactionsCsv(tsv)
    expect(rows[0].amount).toBe(5000000)
    expect(rows[1].amount).toBe(-3000)
  })

  it('handles quoted fields and accounting-negative parens', () => {
    const csv = 'Date,Description,Amount\n2026-06-01,"Fee, quarterly","(1,200.50)"'
    const { rows } = parseTransactionsCsv(csv)
    expect(rows[0].description).toBe('Fee, quarterly')
    expect(rows[0].amount).toBe(-1200.5)
  })

  it('reports bad rows instead of dropping silently', () => {
    const csv = 'Date,Description,Amount\nbadrow,x,y\n2026-06-01,ok,100'
    const { rows, errors } = parseTransactionsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(errors.length).toBe(1)
  })

  it('errors when required columns are missing', () => {
    const { errors } = parseTransactionsCsv('Foo,Bar\n1,2')
    expect(errors.length).toBe(1)
  })

  it('matches header variants and skips metadata rows above the header', () => {
    const csv = 'Acme Bank Statement\nAccount ****1234\n\nPosting Date,Description,Transaction Amount\n07/01/2026,Wire in,5000000'
    const { rows, errors } = parseTransactionsCsv(csv)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ date: '2026-07-01', amount: 5000000 })
  })

  it('handles a newline embedded in a quoted field (brokerage export)', () => {
    const csv = 'Date,Description,Amount($),Running Balance\n06/30/2026,"MORGAN STANLEY BANK N.A.\n(Period 06/01-06/30)",0.50,"60,064.45"'
    const { rows, errors } = parseTransactionsCsv(csv)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBe(0.5)
    expect(rows[0].description).toBe('MORGAN STANLEY BANK N.A. (Period 06/01-06/30)')
  })
})

describe('dedupHash', () => {
  it('is stable and sensitive to the key fields', () => {
    const a = { date: '2026-06-01', amount: 100, description: 'Fee' }
    expect(dedupHash(a)).toBe(dedupHash({ ...a }))
    expect(dedupHash(a)).not.toBe(dedupHash({ ...a, amount: 101 }))
  })
})

describe('suggestCategory', () => {
  it('classifies by keyword', () => {
    expect(suggestCategory({ date: 'd', amount: 5e6, description: 'Capital call' }).sourceType).toBe('capital_call')
    expect(suggestCategory({ date: 'd', amount: -12000, description: 'Annual audit' }).sourceType).toBe('partnership_expense')
    expect(suggestCategory({ date: 'd', amount: -50000, description: 'Management fee Q2' }).sourceType).toBe('management_fee')
  })

  it('reads the activity/type column when the description lacks a keyword', () => {
    // Brokerage feed: keyword is in Activity, description is just the bank name.
    const cat = suggestCategory({ date: 'd', amount: 0.5, description: 'MORGAN STANLEY BANK N.A.', activity: 'Interest Income' })
    expect(cat.sourceType).toBe('income')
    expect(cat.accountCode).toBe('4100')
    expect(cat.confidence).toBe('high')
  })

  it('treats interest as income on inflow and expense on outflow', () => {
    expect(suggestCategory({ date: 'd', amount: 0.5, description: 'x', activity: 'Interest Income' }).accountCode).toBe('4100')
    const exp = suggestCategory({ date: 'd', amount: -420, description: 'Margin interest charged' })
    expect(exp.accountCode).toBe('5300')
    expect(exp.label).toBe('Interest expense')
  })

  it('falls back by direction with low confidence', () => {
    expect(suggestCategory({ date: 'd', amount: 999, description: 'mystery' }).confidence).toBe('low')
    expect(suggestCategory({ date: 'd', amount: -999, description: 'mystery' }).sourceType).toBe('partnership_expense')
  })
})

describe('bankEntryPostings', () => {
  it('builds a balanced two-line entry for inflow and outflow', () => {
    const inflow = bankEntryPostings(5000, 'cash', 'lp')
    expect(isBalanced({ fundId: 'f', entryDate: 'd', postings: inflow })).toBe(true)
    expect(inflow.find(p => p.accountId === 'cash')!.amount).toBe(5000)

    const outflow = bankEntryPostings(-3000, 'cash', 'exp')
    expect(isBalanced({ fundId: 'f', entryDate: 'd', postings: outflow })).toBe(true)
    expect(outflow.find(p => p.accountId === 'cash')!.amount).toBe(-3000)
  })
})

describe('summarizeBankRec', () => {
  it('ties out when ledger cash equals the bank feed and all matched', () => {
    const s = summarizeBankRec([{ amount: 5000, matched: true }, { amount: -2000, matched: true }], 3000)
    expect(s.bankEndingBalance).toBe(3000)
    expect(s.difference).toBe(0)
    expect(s.tiesOut).toBe(true)
  })

  it('surfaces unmatched transactions and the difference', () => {
    const s = summarizeBankRec([{ amount: 5000, matched: true }, { amount: -2000, matched: false }], 5000)
    expect(s.unmatchedCount).toBe(1)
    expect(s.unmatchedTotal).toBe(-2000)
    expect(s.bankEndingBalance).toBe(3000)
    expect(s.difference).toBe(2000) // ledger cash still shows the unbooked outflow
    expect(s.tiesOut).toBe(false)
  })
})

describe('resolveDistributionSplit', () => {
  it('gives the whole amount to a named partner', () => {
    const r = resolveDistributionSplit(10_000, { lpEntityId: 'b' })
    expect('perLp' in r && Array.from(r.perLp.entries())).toEqual([['b', 10_000]])
  })

  it('uses explicit per-LP amounts as given', () => {
    const perLpOverride = new Map([['a', 6_000], ['b', 4_000]])
    const r = resolveDistributionSplit(10_000, { perLpOverride })
    expect('perLp' in r && Object.fromEntries(r.perLp)).toEqual({ a: 6_000, b: 4_000 })
  })

  it('rejects explicit amounts that do not total the transaction', () => {
    const perLpOverride = new Map([['a', 6_000], ['b', 1_000]])
    const r = resolveDistributionSplit(10_000, { perLpOverride })
    expect('error' in r && r.error).toContain('total 7000')
  })

  it('REFUSES an unnamed payment rather than splitting it pro-rata', () => {
    // The bug this guards: a $500 wire to ONE partner was split across all twenty by capital
    // balance, so the recipient was debited $12.50 of their own money. A wire is one payment;
    // pro-rata belongs to DECLARING a distribution, before any money moves.
    const r = resolveDistributionSplit(500, {})
    expect('error' in r).toBe(true)
    expect('error' in r && r.error).toContain('Name the partner')
    expect('error' in r && r.error).toContain('declare it')
  })

  it('refuses an empty override too — an empty map is not an instruction', () => {
    const r = resolveDistributionSplit(500, { perLpOverride: new Map() })
    expect('error' in r).toBe(true)
  })
})
