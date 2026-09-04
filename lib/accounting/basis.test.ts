import { describe, it, expect } from 'vitest'
import { booksForBasis, basisFromParam } from './books'
import { assembleLoadedLedger } from './load'
import { trialBalance } from './statements'

describe('statement basis', () => {
  it('reads the actual book alone by default and both books on a tax basis', () => {
    expect(basisFromParam(null)).toBe('book')
    expect(basisFromParam('anything')).toBe('book')
    expect(basisFromParam('tax')).toBe('tax')
    expect(booksForBasis('book')).toEqual(['actual'])
    expect(booksForBasis('tax')).toEqual(['actual', 'tax'])
  })

  it('a tax-basis ledger is the actual ledger plus the overlay, never the overlay alone', () => {
    const acctRows = [
      { id: 'unrl', code: '1200', name: 'Unrealized appreciation', type: 'asset' },
      { id: 'inc', code: '4200', name: 'Change in unrealized', type: 'income' },
    ]
    const actual = {
      entryRows: [{ id: 'e1', source_type: 'valuation', status: 'posted', entry_date: '2025-06-30', memo: 'mark' }],
      postingRows: [
        { journal_entry_id: 'e1', account_id: 'unrl', amount: 1000, currency: 'USD', lp_entity_id: null },
        { journal_entry_id: 'e1', account_id: 'inc', amount: -1000, currency: 'USD', lp_entity_id: null },
      ],
    }
    const tax = {
      entryRows: [{ id: 't1', source_type: 'tax_adj_unrealized', status: 'posted', entry_date: '2025-12-31', memo: 'reverse unrealized' }],
      postingRows: [
        { journal_entry_id: 't1', account_id: 'unrl', amount: -1000, currency: 'USD', lp_entity_id: null },
        { journal_entry_id: 't1', account_id: 'inc', amount: 1000, currency: 'USD', lp_entity_id: null },
      ],
    }
    const book = assembleLoadedLedger('f', { acctRows, ...actual })
    const spliced = assembleLoadedLedger('f', {
      acctRows,
      entryRows: [...actual.entryRows, ...tax.entryRows],
      postingRows: [...actual.postingRows, ...tax.postingRows],
    })
    expect(trialBalance(book.accounts, book.postings).rows.find(r => r.code === '1200')!.balance).toBe(1000)
    // On a tax basis the unrealized appreciation is gone — book income exceeded tax income by it.
    expect(trialBalance(spliced.accounts, spliced.postings).rows.find(r => r.code === '1200')).toBeUndefined()
    expect(trialBalance(spliced.accounts, spliced.postings).balanced).toBe(true)
  })
})
