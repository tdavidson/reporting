import { describe, it, expect } from 'vitest'
import { serializeLedger, parseLedgerText, textAccountName, codeFromAccountName } from './text-ledger'
import type { Account } from './types'

const accounts: Account[] = [
  { id: 'cash', fundId: 'f', code: '1000', name: 'Cash', type: 'asset' },
  { id: 'lpA', fundId: 'f', code: '3100-aaaa1111', name: "Partners' capital — John Smith", type: 'equity', lpEntityId: 'a' },
  { id: 'lpB', fundId: 'f', code: '3100-bbbb2222', name: "Partners' capital — Acme LLC", type: 'equity', lpEntityId: 'b' },
]

describe('plain-text account names', () => {
  it('builds a Root:Slug:Code name and recovers the code', () => {
    expect(textAccountName(accounts[0])).toBe('Assets:Cash:1000')
    const lp = textAccountName(accounts[1])
    expect(lp.startsWith('Equity:')).toBe(true)
    expect(codeFromAccountName(lp)).toBe('3100-aaaa1111')
  })
})

describe('serializeLedger', () => {
  it('emits opens and a balanced transaction', () => {
    const text = serializeLedger(accounts, [
      { entryDate: '2021-06-01', memo: 'Capital call', sourceType: 'capital_call', status: 'posted', postings: [
        { accountId: 'cash', amount: 5_000_000, currency: 'USD' },
        { accountId: 'lpA', amount: -3_000_000, currency: 'USD' },
        { accountId: 'lpB', amount: -2_000_000, currency: 'USD' },
      ] },
    ])
    expect(text).toContain('2021-06-01 open Assets:Cash:1000')
    expect(text).toContain('2021-06-01 * "Capital call"')
    expect(text).toContain('Assets:Cash:1000  5000000.00 USD')
    expect(text).toContain('-3000000.00 USD')
  })
})

describe('parseLedgerText', () => {
  it('parses a balanced entry with a currency', () => {
    const { entries, errors } = parseLedgerText(`
2021-06-01 * "Capital call"
  Assets:Cash:1000          5000000.00 USD
  Equity:Lp:3100-aaaa1111  -3000000.00 USD
  Equity:Lp:3100-bbbb2222  -2000000.00 USD
`)
    expect(errors).toEqual([])
    expect(entries).toHaveLength(1)
    expect(entries[0].postings).toHaveLength(3)
    expect(codeFromAccountName(entries[0].postings[0].account)).toBe('1000')
  })

  it('infers an elided amount (auto-balance)', () => {
    const { entries, errors } = parseLedgerText(`
2021-06-15 ! "Audit fee"
  Expenses:Audit:5100  12000.00 USD
  Assets:Cash:1000
`)
    expect(errors).toEqual([])
    expect(entries[0].postings[1].amount).toBe(-12000)
    expect(entries[0].flag).toBe('!')
  })

  it('reports an unbalanced entry', () => {
    const { errors } = parseLedgerText(`
2021-06-01 * "Bad"
  Assets:Cash:1000     100.00 USD
  Equity:Lp:3100-aaaa1111  -90.00 USD
`)
    expect(errors.length).toBe(1)
    expect(errors[0]).toMatch(/does not balance/)
  })

  it('ignores comments and open directives', () => {
    const { entries, errors } = parseLedgerText(`
; a comment
2021-01-01 open Assets:Cash:1000
2021-06-01 * "Call"
  Assets:Cash:1000   10.00 USD
  Equity:Lp:3100-aaaa1111  -10.00 USD
`)
    expect(errors).toEqual([])
    expect(entries).toHaveLength(1)
  })

  it('round-trips serialize → parse', () => {
    const input = [
      { entryDate: '2021-06-01', memo: 'Capital call', sourceType: 'capital_call', status: 'posted', postings: [
        { accountId: 'cash', amount: 5_000_000, currency: 'USD' },
        { accountId: 'lpA', amount: -5_000_000, currency: 'USD' },
      ] },
    ]
    const { entries, errors } = parseLedgerText(serializeLedger(accounts, input))
    expect(errors).toEqual([])
    expect(entries[0].date).toBe('2021-06-01')
    expect(entries[0].sourceType).toBe('capital_call')
    expect(codeFromAccountName(entries[0].postings[0].account)).toBe('1000')
    expect(entries[0].postings[0].amount).toBe(5_000_000)
    expect(entries[0].postings[1].amount).toBe(-5_000_000)
  })
})
