import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { buildStatementWorkbook } from './statement-workbook'
import type { StatementPackage } from './statement-package'
import { emptyAccount } from './capital-account'
import type { Account } from './types'

// A minimal-but-valid package: two accounts, one period entry, enough to exercise
// every sheet builder. The point is to prove the workbook is well-formed and that
// numbers land as numeric cells tying to the input — not to re-test the statements.
function fixture(): StatementPackage {
  const accounts: Account[] = [
    { id: 'cash', fundId: 'f', code: '1000', name: 'Cash', type: 'asset' },
    { id: 'fees', fundId: 'f', code: '5000', name: 'Management fees', type: 'expense' },
  ]
  return {
    accounts,
    inPeriodSourced: [
      { entryId: 'e1', accountId: 'fees', amount: 250, currency: 'USD', lpEntityId: null, sourceType: 'expense', entryDate: '2026-03-15', memo: 'Q1 mgmt fee' },
      { entryId: 'e1', accountId: 'cash', amount: -250, currency: 'USD', lpEntityId: null, sourceType: 'expense', entryDate: '2026-03-15', memo: 'Q1 mgmt fee' },
    ],
    payload: {
      period: { preset: 'ytd', start: '2026-01-01', end: '2026-03-31', label: 'YTD 2026' },
      asOf: '2026-03-31',
      trialBalance: {
        rows: [
          { accountId: 'cash', code: '1000', name: 'Cash', type: 'asset', balance: -250, debit: 0, credit: 250 },
          { accountId: 'fees', code: '5000', name: 'Management fees', type: 'expense', balance: 250, debit: 250, credit: 0 },
        ],
        totalDebits: 250, totalCredits: 250, balanced: true,
      },
      balanceSheet: {
        assets: { label: 'Assets', rows: [{ code: '1000', name: 'Cash', amount: -250 }], total: -250 },
        liabilities: { label: 'Liabilities', rows: [], total: 0 },
        equity: { label: "Partners' capital", rows: [], total: -250 },
        check: 0,
        partnersCapital: { total: -250, unallocatedEarnings: -250 },
      },
      incomeStatement: {
        income: { label: 'Income', rows: [], total: 0 },
        expenses: { label: 'Expenses', rows: [{ code: '5000', name: 'Management fees', amount: 250 }], total: 250 },
        netIncome: -250,
      },
      scheduleOfInvestments: {
        rows: [], totalCost: 0, totalFairValue: 0, netAssets: -250, source: 'ledger',
        ledgerCost: 0, ledgerFairValue: 0, costVariance: 0, fairValueVariance: 0,
        byIndustry: [], byGeography: [], byAssetType: [],
      },
      changesInPartnersCapital: {
        partners: [{ id: 'lp1', name: 'Acme LP', ...emptyAccount(), beginning: 0, expenses: 250, ending: -250 }],
        totals: { ...emptyAccount(), expenses: 250, ending: -250 },
      },
      cashFlows: {
        operating: { label: 'Operating activities', lines: [{ code: '5000', name: 'Management fees', amount: -250 }], total: -250 },
        financing: { label: 'Financing activities', lines: [], total: 0 },
        netChange: -250, openingCash: 0, endingCash: -250, nonCash: [],
      },
    },
  }
}

describe('buildStatementWorkbook', () => {
  const wb = buildStatementWorkbook(fixture(), { fundName: 'Test Fund', vehicle: 'Main', generatedAt: '2026-07-17T00:00:00Z' })

  it('produces every workpaper tab', () => {
    expect(wb.SheetNames).toEqual([
      'Cover', 'Trial Balance', 'Balance Sheet', 'Income Statement',
      'Partners Capital', 'Schedule of Investments', 'Cash Flows', 'GL Detail',
    ])
  })

  it('writes the trial-balance totals as numeric cells', () => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Trial Balance'], { header: 1 }) as unknown as unknown[][]
    const totals = rows.find(r => r[1] === 'Totals')!
    expect(totals[3]).toBe(250) // debit total, as a number not a string
    expect(totals[4]).toBe(250) // credit total
  })

  it('carries net income onto the income statement', () => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Income Statement'], { header: 1 })
    const net = rows.find(r => r[0] === 'Net income')!
    expect(net[2]).toBe(-250)
  })

  it('lists GL detail postings under their account with a per-account total', () => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['GL Detail'], { header: 1 })
    expect(rows.some(r => r[0] === '5000 · Management fees')).toBe(true)
    const totalRow = rows.find(r => r[3] === 'Total 5000')!
    expect(totalRow[4]).toBe(250) // debit column
  })

  it('surfaces the unallocated-earnings warning on the cover', () => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Cover'], { header: 1 })
    const flat = rows.flat().join(' ')
    expect(flat).toContain('not yet allocated')
  })
})
