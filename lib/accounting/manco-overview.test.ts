import { describe, it, expect } from 'vitest'
import { quarterKey, quarterCycles, expenseBreakdown, monthlyBurn } from './manco-overview'
import type { Account, Posting } from './types'

const acct = (id: string, code: string, name: string, type: Account['type'], subtype?: string): Account =>
  ({ id, fundId: 'f', code, name, type, subtype: subtype ?? null })

const ACCOUNTS: Account[] = [
  acct('cash', '1000', 'Cash — operating', 'asset', 'cash'),
  acct('fee', '4000', 'Management fee income', 'income', 'management_fee_income'),
  acct('salaries', '5000', 'Salaries and wages', 'expense', 'salaries'),
  acct('rent', '5100', 'Rent and occupancy', 'expense', 'occupancy'),
  acct('depr', '5800', 'Depreciation and amortization', 'expense', 'depreciation'),
]

// Debits positive, credits negative — income arrives as a credit.
const p = (accountId: string, amount: number, entryDate: string): Posting =>
  ({ accountId, amount, currency: 'USD', entryDate })

const WINDOW = { start: '2026-01-01', end: '2026-12-31' }

describe('quarterKey', () => {
  it('maps each month to its quarter', () => {
    expect(quarterKey('2026-01-31')).toBe('2026-Q1')
    expect(quarterKey('2026-03-01')).toBe('2026-Q1')
    expect(quarterKey('2026-04-01')).toBe('2026-Q2')
    expect(quarterKey('2026-12-31')).toBe('2026-Q4')
  })
})

describe('quarterCycles', () => {
  it('flips income to a positive amount earned and leaves expenses as debits', () => {
    const [q1] = quarterCycles(ACCOUNTS, [
      p('fee', -300_000, '2026-01-01'),
      p('salaries', 120_000, '2026-01-31'),
      p('rent', 15_000, '2026-02-28'),
    ], WINDOW)
    expect(q1.revenue).toBe(300_000)
    expect(q1.expenses).toBe(135_000)
    expect(q1.net).toBe(165_000)
  })

  it('fills quarters with no activity rather than skipping them', () => {
    // THE POINT OF THE VIEW. A manco's revenue arrives in four lumps a year; a chart that plots
    // only the quarters with a fee in them draws a straight line through a missed one.
    const rows = quarterCycles(ACCOUNTS, [
      p('fee', -300_000, '2026-01-01'),
      p('fee', -300_000, '2026-10-01'),
    ], WINDOW)
    expect(rows.map(r => r.key)).toEqual(['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4'])
    expect(rows[1].revenue).toBe(0)
    expect(rows[2].revenue).toBe(0)
    expect(rows[3].revenue).toBe(300_000)
  })

  it('spans a window that crosses a year end, in order', () => {
    const rows = quarterCycles(ACCOUNTS, [], { start: '2025-11-01', end: '2026-02-28' })
    expect(rows.map(r => r.key)).toEqual(['2025-Q4', '2026-Q1'])
    expect(rows[0].label).toBe('Q4 2025')
  })

  it('ignores postings outside the window and anything that is not P&L', () => {
    const rows = quarterCycles(ACCOUNTS, [
      p('fee', -300_000, '2025-12-31'),  // before the window
      p('fee', -300_000, '2027-01-01'),  // after it
      p('cash', 300_000, '2026-01-01'),  // an asset, not P&L
    ], WINDOW)
    expect(rows.every(r => r.revenue === 0 && r.expenses === 0)).toBe(true)
  })

  it('returns nothing for an inverted window rather than looping', () => {
    expect(quarterCycles(ACCOUNTS, [], { start: '2026-06-30', end: '2026-01-01' })).toEqual([])
  })
})

describe('expenseBreakdown', () => {
  it('ranks accounts by amount and reports each one’s share', () => {
    const rows = expenseBreakdown(ACCOUNTS, [
      p('salaries', 600_000, '2026-03-31'),
      p('rent', 200_000, '2026-03-31'),
      p('depr', 200_000, '2026-03-31'),
    ], WINDOW)
    expect(rows.map(r => r.code)).toEqual(['5000', '5100', '5800'])
    expect(rows[0].share).toBeCloseTo(0.6)
    expect(rows[1].share).toBeCloseTo(0.2)
  })

  it('drops an account a reversal left at exactly zero', () => {
    const rows = expenseBreakdown(ACCOUNTS, [
      p('salaries', 100_000, '2026-03-31'),
      p('rent', 5_000, '2026-03-31'),
      p('rent', -5_000, '2026-04-30'),
    ], WINDOW)
    expect(rows.map(r => r.code)).toEqual(['5000'])
  })

  it('reports a null share rather than dividing by zero', () => {
    expect(expenseBreakdown(ACCOUNTS, [], WINDOW)).toEqual([])
  })
})

describe('monthlyBurn', () => {
  it('excludes depreciation, which is not cash leaving the building', () => {
    const burn = monthlyBurn(ACCOUNTS, [
      p('salaries', 120_000, '2026-01-31'),
      p('depr', 60_000, '2026-01-31'),
    ], { start: '2026-01-01', end: '2026-02-28' })
    // 120,000 of cash cost over the two months the window covers.
    expect(burn).toBe(60_000)
  })

  it('is null for a window too short to be an average', () => {
    // One month is not an average, and presenting it as one turns a single annual insurance
    // premium into a runway forecast.
    expect(monthlyBurn(ACCOUNTS, [p('salaries', 120_000, '2026-01-31')], {
      start: '2026-01-01', end: '2026-01-31',
    })).toBeNull()
  })

  it('is null for a firm that is not burning', () => {
    expect(monthlyBurn(ACCOUNTS, [p('fee', -300_000, '2026-01-01')], {
      start: '2026-01-01', end: '2026-06-30',
    })).toBeNull()
  })
})
