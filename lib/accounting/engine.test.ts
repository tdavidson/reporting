import { describe, it, expect } from 'vitest'
import { apportionCents, allocateAmount, ownershipFractions } from './allocation'
import { computeCapitalAccounts, totalNav, bucketForSourceType } from './capital-account'
import { reconcileCapital } from './reconcile'
import { trialBalance, balanceSheet, incomeStatement, scheduleOfInvestments, changesInPartnersCapital } from './statements'
import type { Account, Posting } from './types'

describe('apportionCents', () => {
  it('sums exactly to the total, handing leftover cents to largest remainders', () => {
    // $100.00 split 1/1/1 → 33.34 / 33.33 / 33.33 (first index gets the extra cent).
    const parts = apportionCents(10000, [1, 1, 1])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10000)
    expect(parts).toEqual([3334, 3333, 3333])
  })

  it('respects weights', () => {
    const parts = apportionCents(10000, [50, 30, 20])
    expect(parts).toEqual([5000, 3000, 2000])
  })

  it('falls back to even split when the basis is all zero', () => {
    const parts = apportionCents(1000, [0, 0, 0, 0])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000)
    expect(parts).toEqual([250, 250, 250, 250])
  })

  it('handles negative totals (credit allocations)', () => {
    const parts = apportionCents(-10000, [1, 1, 1])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(-10000)
  })
})

describe('allocateAmount', () => {
  it('splits a fee pro-rata by commitment, exact to the cent', () => {
    const owners = [
      { lpEntityId: 'a', commitment: 6_000_000 },
      { lpEntityId: 'b', commitment: 3_000_000 },
      { lpEntityId: 'c', commitment: 1_000_000 },
    ]
    const alloc = allocateAmount(200_000, owners)
    expect(alloc.get('a')).toBe(120_000)
    expect(alloc.get('b')).toBe(60_000)
    expect(alloc.get('c')).toBe(20_000)
    const sum = Array.from(alloc.values()).reduce((x, y) => x + y, 0)
    expect(sum).toBe(200_000)
  })

  it('never loses a penny on awkward ratios', () => {
    const owners = [
      { lpEntityId: 'a', commitment: 1 },
      { lpEntityId: 'b', commitment: 1 },
      { lpEntityId: 'c', commitment: 1 },
    ]
    const alloc = allocateAmount(100.0, owners)
    const sum = Array.from(alloc.values()).reduce((x, y) => x + y, 0)
    expect(sum).toBe(100.0)
  })
})

describe('ownershipFractions', () => {
  it('computes fractions that sum to 1', () => {
    const f = ownershipFractions([
      { lpEntityId: 'a', commitment: 3 },
      { lpEntityId: 'b', commitment: 1 },
    ])
    expect(f.get('a')).toBe(0.75)
    expect(f.get('b')).toBe(0.25)
  })
})

describe('bucketForSourceType', () => {
  it('maps source types to roll-forward lines', () => {
    expect(bucketForSourceType('opening_balance')).toBe('beginning')
    expect(bucketForSourceType('capital_call')).toBe('contributions')
    expect(bucketForSourceType('distribution')).toBe('distributions')
    expect(bucketForSourceType('management_fee')).toBe('managementFees')
    expect(bucketForSourceType('partnership_expense')).toBe('expenses')
    expect(bucketForSourceType('realized_gain')).toBe('gains')
    expect(bucketForSourceType('mystery')).toBe('other')
  })
})

describe('computeCapitalAccounts', () => {
  it('rolls a period forward per LP; ending ties to the raw sum', () => {
    // LP-a: open 100k, called 50k, fee -2k, gain +10k → 158k
    // LP-b: open 40k, called 20k, distribution -5k → 55k
    const postings = [
      { lpEntityId: 'a', amount: -100_000, sourceType: 'opening_balance' }, // credit = +capital
      { lpEntityId: 'a', amount: -50_000, sourceType: 'capital_call' },
      { lpEntityId: 'a', amount: 2_000, sourceType: 'management_fee' }, // debit reduces capital
      { lpEntityId: 'a', amount: -10_000, sourceType: 'realized_gain' },
      { lpEntityId: 'b', amount: -40_000, sourceType: 'opening_balance' },
      { lpEntityId: 'b', amount: -20_000, sourceType: 'capital_call' },
      { lpEntityId: 'b', amount: 5_000, sourceType: 'distribution' },
    ]
    const accounts = computeCapitalAccounts(postings)
    const a = accounts.get('a')!
    expect(a.beginning).toBe(100_000)
    expect(a.contributions).toBe(50_000)
    expect(a.managementFees).toBe(-2_000)
    expect(a.gains).toBe(10_000)
    expect(a.ending).toBe(158_000)

    const b = accounts.get('b')!
    expect(b.distributions).toBe(-5_000)
    expect(b.ending).toBe(55_000)

    expect(totalNav(accounts)).toBe(213_000)
  })
})

describe('reconcileCapital', () => {
  const ledger = computeCapitalAccounts([
    { lpEntityId: 'a', amount: -100_000, sourceType: 'opening_balance' },
    { lpEntityId: 'a', amount: -50_000, sourceType: 'capital_call' },
  ])

  it('ties out when the admin agrees', () => {
    const admin = new Map([['a', { beginning: 100_000, contributions: 50_000, ending: 150_000 }]])
    const res = reconcileCapital(ledger, admin)
    expect(res.allTieOut).toBe(true)
    expect(res.maxAbsDelta).toBe(0)
    expect(res.reconciled).toEqual(['a'])
  })

  it('localizes a discrepancy to the line and LP', () => {
    const admin = new Map([['a', { ending: 148_000 }]])
    const res = reconcileCapital(ledger, admin)
    expect(res.allTieOut).toBe(false)
    const endingLine = res.lines.find(l => l.line === 'ending')!
    expect(endingLine.delta).toBe(2_000) // ledger is 2k higher than admin
    expect(endingLine.tiesOut).toBe(false)
  })

  it('flags LPs present on only one side', () => {
    const admin = new Map([['b', { ending: 10 }]])
    const res = reconcileCapital(ledger, admin)
    expect(res.ledgerOnly).toEqual(['a'])
    expect(res.adminOnly).toEqual(['b'])
    expect(res.allTieOut).toBe(false)
  })
})

describe('statements', () => {
  const accounts: Account[] = [
    { id: 'cash', fundId: 'f', code: '1000', name: 'Cash', type: 'asset' },
    { id: 'lp', fundId: 'f', code: '3100', name: 'LP Capital', type: 'equity' },
    { id: 'fee', fundId: 'f', code: '5000', name: 'Management fee', type: 'expense' },
    { id: 'gain', fundId: 'f', code: '4000', name: 'Realized gains', type: 'income' },
  ]
  // Call 100k cash / credit LP capital; pay 2k fee from cash; book 10k gain to cash & income.
  const postings: Posting[] = [
    { accountId: 'cash', amount: 100_000, currency: 'USD' },
    { accountId: 'lp', amount: -100_000, currency: 'USD' },
    { accountId: 'fee', amount: 2_000, currency: 'USD' },
    { accountId: 'cash', amount: -2_000, currency: 'USD' },
    { accountId: 'cash', amount: 10_000, currency: 'USD' },
    { accountId: 'gain', amount: -10_000, currency: 'USD' },
  ]

  it('produces a balanced trial balance', () => {
    const tb = trialBalance(accounts, postings)
    expect(tb.balanced).toBe(true)
    expect(tb.totalDebits).toBe(tb.totalCredits)
    expect(tb.rows.find(r => r.accountId === 'cash')!.balance).toBe(108_000)
  })

  it('income statement nets income minus expenses', () => {
    const is = incomeStatement(accounts, postings)
    expect(is.income.total).toBe(10_000)
    expect(is.expenses.total).toBe(2_000)
    expect(is.netIncome).toBe(8_000)
  })

  it('balance sheet: assets = liabilities + equity', () => {
    const bs = balanceSheet(accounts, postings)
    expect(bs.assets.total).toBe(108_000)
    expect(bs.equity.total).toBe(100_000)
    // check is assets - liabilities - equity; equity here excludes retained income,
    // so the 8k net income is the residual (unbooked to capital yet).
    expect(bs.check).toBe(8_000)
  })
})

describe('schedule of investments', () => {
  const accts: Account[] = [
    { id: 'cost', fundId: 'f', code: '1100', name: 'Investments at cost', type: 'asset', subtype: 'investment' },
    { id: 'unrl', fundId: 'f', code: '1200', name: 'Unrealized', type: 'asset', subtype: 'unrealized' },
  ]
  it('fair value = cost + unrealized, with % of net assets', () => {
    const p: Posting[] = [
      { accountId: 'cost', amount: 4_800_000, currency: 'USD' },
      { accountId: 'unrl', amount: 1_000_000, currency: 'USD' },
    ]
    const soi = scheduleOfInvestments(accts, p, 5_800_000)
    expect(soi.totalCost).toBe(4_800_000)
    expect(soi.totalFairValue).toBe(5_800_000)
    expect(soi.rows[0].pctOfNetAssets).toBe(1)
  })
})

describe('statement of changes in partners capital', () => {
  it('lists each LP plus a GP row with a totals column', () => {
    const caps = computeCapitalAccounts([
      { lpEntityId: 'a', amount: -100_000, sourceType: 'opening_balance' },
      { lpEntityId: 'a', amount: -50_000, sourceType: 'capital_call' },
      { lpEntityId: 'b', amount: -40_000, sourceType: 'opening_balance' },
    ])
    const names = new Map([['a', 'Smith'], ['b', 'Acme']])
    const st = changesInPartnersCapital(caps, names, 25_000)
    expect(st.partners).toHaveLength(3) // 2 LPs + GP
    expect(st.partners.find(p => p.id === 'gp')!.ending).toBe(25_000)
    expect(st.totals.ending).toBe(215_000) // 150k + 40k + 25k
    expect(st.totals.contributions).toBe(50_000)
  })
})
