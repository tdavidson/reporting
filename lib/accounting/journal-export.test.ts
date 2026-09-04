import { describe, it, expect } from 'vitest'
import { toCsv } from './csv'
import { journalRows, quickbooksJournalRows, chartRows, generalLedgerRows, type ExportEntry } from './journal-export'
import { parseQbJournal } from './quickbooks/parse-journal'
import { trialBalance } from './statements'
import type { Account } from './types'

const entries: ExportEntry[] = [
  {
    id: 'b2222222-0000-0000-0000-000000000000', entryDate: '2025-03-31', memo: 'Q1 fee, accrued', sourceType: 'management_fee', sourceRef: null, status: 'posted',
    postings: [
      { accountCode: '5000', accountName: 'Management fee', amount: 50, currency: 'USD' },
      { accountCode: '2100', accountName: 'Due to GP', amount: -50, currency: 'USD' },
    ],
  },
  {
    id: 'a1111111-0000-0000-0000-000000000000', entryDate: '2025-01-15', memo: 'Capital call "one"', sourceType: 'capital_call', sourceRef: null, status: 'posted',
    postings: [
      { accountCode: '1000', accountName: 'Cash', amount: 1000, currency: 'USD' },
      { accountCode: '3100-aaaa', accountName: "Partners' capital — A", amount: -600, currency: 'USD' },
      { accountCode: '3100-bbbb', accountName: "Partners' capital — B", amount: -400, currency: 'USD' },
    ],
  },
]

describe('journalRows', () => {
  it('writes one row per posting, in date then id order, with debit and credit split', () => {
    const rows = journalRows(entries)
    expect(rows[0][0]).toBe('Date')
    expect(rows.slice(1).map(r => r[0])).toEqual(['2025-01-15', '2025-01-15', '2025-01-15', '2025-03-31', '2025-03-31'])
    expect(rows[1].slice(5, 9)).toEqual(['1000', 'Cash', 1000, null])
    expect(rows[2].slice(7, 9)).toEqual([null, 600])
  })
})

describe('quickbooksJournalRows', () => {
  it('round-trips through the QuickBooks Journal parser', () => {
    const csv = toCsv(quickbooksJournalRows(entries))
    const parsed = parseQbJournal(csv)
    expect(parsed.errors).toEqual([])
    expect(parsed.transactions).toHaveLength(2)

    const [call, fee] = parsed.transactions
    expect(call.date).toBe('2025-01-15')
    expect(call.type).toBe('Journal Entry')
    expect(call.num).toBe('a1111111')
    expect(call.memo).toBe('Capital call "one"')
    expect(call.lines.map(l => [l.account, l.debit, l.credit])).toEqual([
      ['1000 · Cash', 1000, 0],
      ["3100-aaaa · Partners' capital — A", 0, 600],
      ["3100-bbbb · Partners' capital — B", 0, 400],
    ])
    expect(fee.lines.map(l => [l.debit, l.credit])).toEqual([[50, 0], [0, 50]])
  })

  it('blanks date, type and num on continuation lines so the parser groups them', () => {
    const rows = quickbooksJournalRows(entries)
    expect(rows[1].slice(0, 3)).toEqual(['2025-01-15', 'Journal Entry', 'a1111111'])
    expect(rows[2].slice(0, 3)).toEqual(['', '', ''])
  })
})

describe('chartRows', () => {
  it('lists the chart by code with the normal side spelled out', () => {
    const rows = chartRows([
      { id: 'b', fundId: 'f', code: '3000', name: 'GP capital', type: 'equity', subtype: 'gp_capital' },
      { id: 'a', fundId: 'f', code: '1000', name: 'Cash', type: 'asset', subtype: 'cash', isActive: false },
    ])
    expect(rows[1].slice(0, 6)).toEqual(['1000', 'Cash', 'asset', 'cash', 'debit', 'no'])
    expect(rows[2].slice(0, 6)).toEqual(['3000', 'GP capital', 'equity', 'gp_capital', 'credit', 'yes'])
  })
})

describe('generalLedgerRows', () => {
  const accounts: Account[] = [
    { id: 'cash', fundId: 'f', code: '1000', name: 'Cash', type: 'asset' },
    { id: 'lpa', fundId: 'f', code: '3100-aaaa', name: 'Capital A', type: 'equity' },
    { id: 'idle', fundId: 'f', code: '9999', name: 'Never used', type: 'expense' },
  ]
  const postings = [
    { entryId: 'e1', entryDate: '2024-12-01', accountId: 'cash', amount: 100, memo: 'prior year', sourceType: null },
    { entryId: 'e1', entryDate: '2024-12-01', accountId: 'lpa', amount: -100, memo: 'prior year', sourceType: null },
    { entryId: 'e2', entryDate: '2025-02-01', accountId: 'cash', amount: -30, memo: 'this year', sourceType: null },
    { entryId: 'e2', entryDate: '2025-02-01', accountId: 'lpa', amount: 30, memo: 'this year', sourceType: null },
  ]

  it('opens each account at the balance carried in and closes at the trial balance', () => {
    const rows = generalLedgerRows(accounts, postings, { start: '2025-01-01', end: '2025-12-31' })
    const cash = rows.filter(r => r[0] === '1000')
    expect(cash[0][5]).toBe('Opening balance')
    expect(cash[0][9]).toBe(100)
    expect(cash[1].slice(7, 10)).toEqual([null, 30, 70])
    expect(cash[2][5]).toBe('Closing balance')
    expect(cash[2][9]).toBe(70)
    const tb = trialBalance(accounts, postings.map(p => ({ ...p, currency: 'USD' })))
    expect(tb.rows.find(r => r.code === '1000')!.balance).toBe(70)
    expect(rows.some(r => r[0] === '9999')).toBe(false)
  })
})
