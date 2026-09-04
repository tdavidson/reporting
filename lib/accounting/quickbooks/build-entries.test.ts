import { describe, it, expect } from 'vitest'
import { buildEntries, qbSourceRef, qbVendorName } from './build-entries'
import type { QbTransaction } from './parse-journal'

const txn: QbTransaction = {
  date: '2024-01-15', type: 'Journal Entry', num: 'JE-1', memo: 'Capital call — Acme III',
  lines: [
    { account: 'Investments:Acme Ventures III', name: null, memo: 'Capital call', debit: 1_000_000, credit: 0 },
    { account: 'Bank:Operating', name: null, memo: 'Capital call', debit: 0, credit: 1_000_000 },
  ],
}

const MAPPING = new Map([['Investments:Acme Ventures III', '1100'], ['Bank:Operating', '1000']])
const IDS = new Map([['1100', 'acct-1100'], ['1000', 'acct-1000']])

describe('qbSourceRef', () => {
  it('is stable across runs for the same transaction', () => {
    expect(qbSourceRef(txn)).toBe(qbSourceRef({ ...txn, lines: [...txn.lines] }))
    expect(qbSourceRef(txn)).toMatch(/^qb:[0-9a-f]+$/)
  })

  it('changes when an amount changes, so a corrected export re-imports', () => {
    const edited = { ...txn, lines: [{ ...txn.lines[0], debit: 999 }, txn.lines[1]] }
    expect(qbSourceRef(edited)).not.toBe(qbSourceRef(txn))
  })

  it('is insensitive to line order, which QuickBooks does not guarantee', () => {
    const reordered = { ...txn, lines: [txn.lines[1], txn.lines[0]] }
    expect(qbSourceRef(reordered)).toBe(qbSourceRef(txn))
  })

  it('distinguishes two same-day transactions with different numbers', () => {
    expect(qbSourceRef({ ...txn, num: 'JE-2' })).not.toBe(qbSourceRef(txn))
  })
})

describe('buildEntries', () => {
  it('converts debit/credit columns into signed postings', () => {
    const { entries } = buildEntries([txn], MAPPING, IDS, 'fund-1')
    expect(entries).toHaveLength(1)
    const [e] = entries
    expect(e.entryDate).toBe('2024-01-15')
    expect(e.fundId).toBe('fund-1')
    expect(e.postings.map(p => p.amount)).toEqual([1_000_000, -1_000_000])
    expect(e.postings.map(p => p.accountId)).toEqual(['acct-1100', 'acct-1000'])
  })

  it('stamps sourceType and a stable sourceRef for idempotent re-import', () => {
    const [e] = buildEntries([txn], MAPPING, IDS, 'fund-1').entries
    expect(e.sourceType).toBe('quickbooks')
    expect(e.sourceRef).toBe(qbSourceRef(txn))
  })

  it('marks every imported entry as a draft', () => {
    // Nothing posts on import. A bad mapping is then re-runnable rather than needing reversal.
    const [e] = buildEntries([txn], MAPPING, IDS, 'fund-1').entries
    expect(e.status).toBe('draft')
  })

  it('carries the QuickBooks type and number into the memo so an entry is traceable', () => {
    const [e] = buildEntries([txn], MAPPING, IDS, 'fund-1').entries
    expect(e.memo).toMatch(/JE-1/)
    expect(e.memo).toMatch(/Capital call/)
  })

  it('skips a transaction with an unmapped account, naming the account', () => {
    const partial = new Map([['Bank:Operating', '1000']])
    const { entries, skipped } = buildEntries([txn], partial, IDS, 'fund-1')
    expect(entries).toEqual([])
    expect(skipped[0].reason).toMatch(/Investments:Acme Ventures III/)
  })

  it('skips a transaction whose mapped code has no account in the chart', () => {
    const { entries, skipped } = buildEntries([txn], MAPPING, new Map([['1000', 'acct-1000']]), 'fund-1')
    expect(entries).toEqual([])
    expect(skipped[0].reason).toMatch(/1100/)
  })

  it('produces balanced postings for a multi-split transaction', () => {
    const multi: QbTransaction = {
      ...txn, num: 'JE-2',
      lines: [
        { account: 'Investments:Acme Ventures III', name: null, memo: null, debit: 900, credit: 0 },
        { account: 'Bank:Operating', name: null, memo: null, debit: 100, credit: 0 },
        { account: 'Bank:Operating', name: null, memo: null, debit: 0, credit: 1000 },
      ],
    }
    const [e] = buildEntries([multi], MAPPING, IDS, 'fund-1').entries
    expect(e.postings.reduce((a, p) => a + p.amount, 0)).toBe(0)
    expect(e.postings).toHaveLength(3)
  })

  it('keeps good transactions when a neighbour is skipped', () => {
    const bad: QbTransaction = {
      ...txn, num: 'JE-3',
      lines: [{ account: 'Unmapped Thing', name: null, memo: null, debit: 5, credit: 0 },
              { account: 'Bank:Operating', name: null, memo: null, debit: 0, credit: 5 }],
    }
    const { entries, skipped } = buildEntries([txn, bad], MAPPING, IDS, 'fund-1')
    expect(entries).toHaveLength(1)
    expect(skipped).toHaveLength(1)
  })
})

describe('vendors on import', () => {
  const paid: QbTransaction = {
    date: '2024-02-01', type: 'Check', num: '1042', memo: 'Audit fee',
    lines: [
      { account: 'Investments:Acme Ventures III', name: 'Acme Audit LLP', memo: null, debit: 5000, credit: 0 },
      { account: 'Bank:Operating', name: 'Acme Audit LLP', memo: null, debit: 0, credit: 5000 },
    ],
  }

  it('reads the payee from the first named line', () => {
    expect(qbVendorName(paid)).toBe('Acme Audit LLP')
    expect(qbVendorName(txn)).toBeNull()
  })

  it('carries the resolved vendor id onto the entry, case-insensitively, and none without a map', () => {
    const ids = new Map([['acme audit llp', 'vendor-1']])
    expect(buildEntries([paid], MAPPING, IDS, 'fund-1', ids).entries[0].vendorId).toBe('vendor-1')
    expect(buildEntries([paid], MAPPING, IDS, 'fund-1').entries[0].vendorId).toBeNull()
    expect(buildEntries([txn], MAPPING, IDS, 'fund-1', ids).entries[0].vendorId).toBeNull()
  })
})
