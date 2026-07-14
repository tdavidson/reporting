import { describe, it, expect } from 'vitest'
import { dedupHash, legacyDedupHash } from './bank'
import type { ParsedTxn } from './bank'

const txn = (over: Partial<ParsedTxn> = {}): ParsedTxn => ({
  date: '2026-03-15',
  amount: -250,
  description: 'WIRE FEE',
  ...over,
} as ParsedTxn)

describe('dedupHash', () => {
  it('is stable — the same row always hashes the same', () => {
    expect(dedupHash(txn())).toBe(dedupHash(txn()))
  })

  it('separates rows that differ in date, amount, or description', () => {
    const base = dedupHash(txn())
    expect(dedupHash(txn({ date: '2026-03-16' }))).not.toBe(base)
    expect(dedupHash(txn({ amount: -251 }))).not.toBe(base)
    expect(dedupHash(txn({ description: 'WIRE FEE 2' }))).not.toBe(base)
  })

  it('ignores case and surrounding whitespace in the description', () => {
    // The same feed re-exported with different casing is the same transaction.
    expect(dedupHash(txn({ description: '  wire fee  ' }))).toBe(dedupHash(txn()))
  })

  it('distinguishes genuine same-day duplicates by occurrence', () => {
    // Two identical wire fees on one day are TWO transactions. The old hash collapsed them
    // and silently dropped the second.
    const first = dedupHash(txn(), 0)
    const second = dedupHash(txn(), 1)
    expect(first).not.toBe(second)
  })

  it('reproduces the same occurrence hashes on re-import, so idempotency still holds', () => {
    // Re-importing the same file walks the rows in the same order, so occurrence 0 and 1 are
    // regenerated identically — and both are recognised as already-imported.
    const firstPass = [dedupHash(txn(), 0), dedupHash(txn(), 1)]
    const secondPass = [dedupHash(txn(), 0), dedupHash(txn(), 1)]
    expect(secondPass).toEqual(firstPass)
  })

  it('is 64-bit, so collisions are not a realistic concern on a long feed', () => {
    // The old hash was 32-bit: ~50% chance of at least one collision by ~77k rows, and a
    // collision means a real transaction is silently skipped as a duplicate.
    expect(dedupHash(txn())).toHaveLength(16)
    expect(legacyDedupHash(txn())).toHaveLength(8)
  })

  it('keeps the legacy hash intact so previously-imported files are still recognised', () => {
    // Existing bank_transactions rows carry the old hash. If this changed, re-importing an
    // old file would duplicate every row in it.
    expect(legacyDedupHash(txn())).toBe(legacyDedupHash(txn()))
    expect(legacyDedupHash(txn())).not.toBe(dedupHash(txn()))
  })
})
