import { describe, it, expect } from 'vitest'
import { reversalOf, reversalDateError, reversedEntryId, reversalRef } from './reversal'
import { isBalanced } from './ledger'

const original = {
  id: 'abcdef12-0000-0000-0000-000000000000',
  fundId: 'f',
  entryDate: '2025-03-31',
  memo: 'Q1 management fee',
  sourceType: 'management_fee',
  reference: 'INV-7',
  postings: [
    { accountId: 'fee', amount: 50.25, currency: 'USD', lpEntityId: null },
    { accountId: 'gp', amount: -50.25, currency: 'USD', lpEntityId: 'gp-entity' },
  ],
}

describe('reversalOf', () => {
  it('negates every posting and keeps partner, source type and reference', () => {
    const r = reversalOf(original, '2025-04-01')
    expect(r.entryDate).toBe('2025-04-01')
    expect(r.postings.map(p => p.amount)).toEqual([-50.25, 50.25])
    expect(r.postings[1].lpEntityId).toBe('gp-entity')
    expect(r.sourceType).toBe('management_fee')
    expect(r.reference).toBe('INV-7')
    expect(r.sourceRef).toBe(reversalRef(original.id))
    expect(r.memo).toBe('Reversal of Q1 management fee')
    expect(isBalanced(r)).toBe(true)
  })

  it('keeps the adjusting flag, so the reversal lists with the adjustments', () => {
    expect(reversalOf({ ...original, adjusting: true }, '2025-04-01').adjusting).toBe(true)
    expect(reversalOf(original, '2025-04-01').adjusting).toBe(false)
  })

  it('names the entry by id when it has no memo', () => {
    expect(reversalOf({ ...original, memo: '  ' }, '2025-04-01').memo).toBe('Reversal of entry abcdef12')
  })
})

describe('reversalDateError', () => {
  it('refuses a missing, malformed, or earlier date and allows the same day', () => {
    expect(reversalDateError('2025-03-31', null)).toMatch(/required/)
    expect(reversalDateError('2025-03-31', '31/03/2025')).toMatch(/required/)
    expect(reversalDateError('2025-03-31', '2025-03-30')).toMatch(/before/)
    expect(reversalDateError('2025-03-31', '2025-03-31')).toBeNull()
    expect(reversalDateError('2025-03-31', '2025-04-01')).toBeNull()
  })
})

describe('reversedEntryId', () => {
  it('reads the original id off a reversal tag and nothing off other tags', () => {
    expect(reversedEntryId('reversal:abc')).toBe('abc')
    expect(reversedEntryId('close:xyz')).toBeNull()
    expect(reversedEntryId(null)).toBeNull()
  })
})
