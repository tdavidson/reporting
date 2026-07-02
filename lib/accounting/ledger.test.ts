import { describe, it, expect } from 'vitest'
import {
  isBalanced,
  assertBalanced,
  entryImbalance,
  accountBalances,
  normalBalance,
  capitalByEntity,
  simpleEntry,
  roundCents,
} from './ledger'
import type { Account, JournalEntry } from './types'

const base = { fundId: 'fund-1', entryDate: '2026-06-30' }

describe('roundCents', () => {
  it('rounds to two decimals and kills float drift', () => {
    expect(roundCents(0.1 + 0.2)).toBe(0.3)
    expect(roundCents(1000.005)).toBe(1000.01)
  })
})

describe('balance invariant', () => {
  it('accepts a balanced two-line entry', () => {
    const e = simpleEntry(base, { debit: 'cash', credit: 'lp-capital', amount: 100000 })
    expect(isBalanced(e)).toBe(true)
    expect(() => assertBalanced(e)).not.toThrow()
  })

  it('rejects an unbalanced entry and localizes the currency', () => {
    const e: JournalEntry = {
      ...base,
      postings: [
        { accountId: 'cash', amount: 100000, currency: 'USD' },
        { accountId: 'lp-capital', amount: -90000, currency: 'USD' },
      ],
    }
    expect(isBalanced(e)).toBe(false)
    expect(entryImbalance(e)).toEqual({ USD: 10000 })
    expect(() => assertBalanced(e)).toThrow(/does not balance/)
  })

  it('checks each currency independently', () => {
    const e: JournalEntry = {
      ...base,
      postings: [
        { accountId: 'cash-usd', amount: 100, currency: 'USD' },
        { accountId: 'lp-usd', amount: -100, currency: 'USD' },
        { accountId: 'cash-eur', amount: 50, currency: 'EUR' },
        { accountId: 'lp-eur', amount: -40, currency: 'EUR' },
      ],
    }
    expect(isBalanced(e)).toBe(false)
    expect(entryImbalance(e)).toEqual({ USD: 0, EUR: 10 })
  })

  it('rejects an empty entry', () => {
    expect(() => assertBalanced({ ...base, postings: [] })).toThrow(/no postings/)
  })

  it('tolerates sub-cent rounding across many postings', () => {
    // Three LPs splitting $100.00 as 33.33 / 33.33 / 33.34 against one credit.
    const e: JournalEntry = {
      ...base,
      postings: [
        { accountId: 'fee-exp', amount: 100, currency: 'USD' },
        { accountId: 'lp-a', amount: -33.33, currency: 'USD', lpEntityId: 'a' },
        { accountId: 'lp-b', amount: -33.33, currency: 'USD', lpEntityId: 'b' },
        { accountId: 'lp-c', amount: -33.34, currency: 'USD', lpEntityId: 'c' },
      ],
    }
    expect(isBalanced(e)).toBe(true)
  })
})

describe('balance queries', () => {
  it('sums signed amounts per account', () => {
    const balances = accountBalances([
      { accountId: 'cash', amount: 100, currency: 'USD' },
      { accountId: 'cash', amount: -30, currency: 'USD' },
      { accountId: 'lp', amount: -70, currency: 'USD' },
    ])
    expect(balances.get('cash')).toBe(70)
    expect(balances.get('lp')).toBe(-70)
  })

  it('expresses balances on the account normal side', () => {
    const cash: Account = { id: 'cash', fundId: 'f', code: '1000', name: 'Cash', type: 'asset' }
    const lpCap: Account = { id: 'lp', fundId: 'f', code: '3000', name: 'LP Capital', type: 'equity' }
    // Cash has net debits of 70 → reads +70 (asset, debit-normal).
    expect(normalBalance(cash, 70)).toBe(70)
    // LP capital has net credits of 70 (debit-side sum = -70) → reads +70.
    expect(normalBalance(lpCap, -70)).toBe(70)
  })
})

describe('capitalByEntity', () => {
  it('rolls per-LP equity up as positive capital', () => {
    // Two LPs contribute (credit their capital), one takes a distribution (debit).
    const postings = [
      { accountId: 'cash', amount: 150, currency: 'USD' },
      { accountId: 'lp-a-cap', amount: -100, currency: 'USD', lpEntityId: 'a' },
      { accountId: 'lp-b-cap', amount: -50, currency: 'USD', lpEntityId: 'b' },
      // Distribution to A: debit A's capital, credit cash.
      { accountId: 'lp-a-cap', amount: 20, currency: 'USD', lpEntityId: 'a' },
      { accountId: 'cash', amount: -20, currency: 'USD' },
    ]
    const cap = capitalByEntity(postings)
    expect(cap.get('a')).toBe(80)
    expect(cap.get('b')).toBe(50)
  })
})
