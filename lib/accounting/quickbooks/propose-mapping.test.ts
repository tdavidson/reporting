import { describe, it, expect } from 'vitest'
import { proposeMapping } from './propose-mapping'

const CHART = [
  { id: 'a1', code: '1000', name: 'Cash', type: 'asset', subtype: 'cash' },
  { id: 'a2', code: '1100', name: 'Investments at cost', type: 'asset', subtype: 'investment' },
  { id: 'a3', code: '5100', name: 'Partnership expenses', type: 'expense', subtype: 'partnership_expense' },
  { id: 'a4', code: '5000', name: 'Management fee', type: 'expense', subtype: 'management_fee' },
]
const qb = (account: string) => ({ account, lineCount: 1, totalDebit: 0, totalCredit: 0 })

describe('proposeMapping', () => {
  it('maps a bank account to cash', () => {
    const [p] = proposeMapping([qb('Bank:Operating')], CHART)
    expect(p.code).toBe('1000')
    expect(p.confidence).not.toBe('none')
  })

  it('maps an investment sub-account and flags the holding it implies', () => {
    // The key move: a per-fund investment account in QuickBooks IS the discovery of a
    // fund holding. The leaf name becomes the holding.
    const [p] = proposeMapping([qb('Investments:Acme Ventures III')], CHART)
    expect(p.code).toBe('1100')
    expect(p.suggestsHolding).toBe('Acme Ventures III')
  })

  it('does not suggest a holding for the investments parent itself', () => {
    const [p] = proposeMapping([qb('Investments')], CHART)
    expect(p.suggestsHolding).toBeNull()
  })

  it('does not suggest a holding for a top-level account that merely has a fund-like name', () => {
    // "Acme Ventures III" with no parent could be anything — a vendor, an expense line.
    // Guessing here would create a phantom holding with a real commitment field.
    const [p] = proposeMapping([qb('Acme Ventures III')], CHART)
    expect(p.suggestsHolding).toBeNull()
  })

  it('matches on our account name exactly, case-insensitively', () => {
    const [p] = proposeMapping([qb('management fee')], CHART)
    expect(p.code).toBe('5000')
    expect(p.confidence).toBe('exact')
  })

  it('returns none with a reason when nothing matches, rather than a wrong guess', () => {
    const [p] = proposeMapping([qb('Suspense — ask Dana')], CHART)
    expect(p.code).toBeNull()
    expect(p.confidence).toBe('none')
    expect(p.reason.length).toBeGreaterThan(10)
  })

  it('returns one proposal per QuickBooks account, in the order given', () => {
    const ps = proposeMapping([qb('Bank:Operating'), qb('Management Fee')], CHART)
    expect(ps.map(p => p.qbAccount)).toEqual(['Bank:Operating', 'Management Fee'])
  })

  it('maps a keyword hit to a likely, not an exact, match', () => {
    const [p] = proposeMapping([qb('Audit Fees')], CHART)
    expect(p.code).toBe('5100')
    expect(p.confidence).toBe('likely')
    expect(p.reason).toMatch(/5100/)
  })

  it('falls back to none when the keyword has no account in this chart', () => {
    // The chart has no realized-gain account, so a realized-gain QB account cannot be mapped.
    const [p] = proposeMapping([qb('Realized Gain on Sale')], CHART)
    expect(p.code).toBeNull()
    expect(p.confidence).toBe('none')
  })
})
