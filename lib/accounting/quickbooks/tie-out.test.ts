import { describe, it, expect } from 'vitest'
import { parseQbTrialBalance, compareTrialBalance } from './tie-out'
import type { TrialBalance } from '@/lib/accounting/statements'

const TB_TEXT = [
  'Account,Debit,Credit',
  'Bank:Operating,"250,000.00",',
  'Investments:Acme Ventures III,"3,000,000.00",',
  "Partners' Capital,,\"3,250,000.00\"",
  'TOTAL,"3,250,000.00","3,250,000.00"',
].join('\n')

const MAPPING = new Map([
  ['Bank:Operating', '1000'],
  ['Investments:Acme Ventures III', '1100'],
  ["Partners' Capital", '3100'],
])

const ours = (rows: { code: string; name: string; balance: number }[]) =>
  ({ rows, totalDebits: 0, totalCredits: 0, balanced: true }) as unknown as TrialBalance

describe('parseQbTrialBalance', () => {
  it('parses accounts and drops the total row', () => {
    const { rows, errors } = parseQbTrialBalance(TB_TEXT)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({ account: 'Bank:Operating', debit: 250_000, credit: 0 })
  })

  it('reports a missing column rather than guessing', () => {
    const { rows, errors } = parseQbTrialBalance('Account\nBank:Operating')
    expect(rows).toEqual([])
    expect(errors.join(' ')).toMatch(/debit|credit/i)
  })
})

describe('compareTrialBalance', () => {
  const theirs = parseQbTrialBalance(TB_TEXT).rows

  it('ties when every mapped account agrees', () => {
    const result = compareTrialBalance(
      ours([
        { code: '1000', name: 'Cash', balance: 250_000 },
        { code: '1100', name: 'Investments at cost', balance: 3_000_000 },
        { code: '3100', name: "Partners' capital", balance: -3_250_000 },
      ]),
      theirs,
      MAPPING,
    )
    expect(result.ties).toBe(true)
    expect(result.lines).toEqual([])
  })

  it('reports the account and the amount when one differs', () => {
    const result = compareTrialBalance(
      ours([
        { code: '1000', name: 'Cash', balance: 240_000 },
        { code: '1100', name: 'Investments at cost', balance: 3_000_000 },
        { code: '3100', name: "Partners' capital", balance: -3_250_000 },
      ]),
      theirs,
      MAPPING,
    )
    expect(result.ties).toBe(false)
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]).toMatchObject({ code: '1000', ours: 240_000, theirs: 250_000, difference: -10_000 })
  })

  it('reports an account QuickBooks has and we do not', () => {
    const result = compareTrialBalance(ours([]), theirs, MAPPING)
    expect(result.ties).toBe(false)
    expect(result.lines).toHaveLength(3)
    expect(result.lines.every(l => l.ours === 0)).toBe(true)
  })

  it('reports an account we have and QuickBooks does not', () => {
    const result = compareTrialBalance(
      ours([{ code: '5000', name: 'Management fee', balance: 50_000 }]),
      [],
      MAPPING,
    )
    expect(result.lines.find(l => l.code === '5000')).toMatchObject({ ours: 50_000, theirs: 0 })
  })

  it('sums several QuickBooks accounts that map to one of ours', () => {
    const many = [
      { account: 'Bank:Operating', debit: 100_000, credit: 0 },
      { account: 'Bank:Savings', debit: 150_000, credit: 0 },
    ]
    const mapping = new Map([['Bank:Operating', '1000'], ['Bank:Savings', '1000']])
    const result = compareTrialBalance(ours([{ code: '1000', name: 'Cash', balance: 250_000 }]), many, mapping)
    expect(result.ties).toBe(true)
  })

  it('ignores unmapped QuickBooks accounts rather than reporting them as differences', () => {
    // An unmapped account is a MAPPING problem, surfaced on the mapping screen. Reporting it
    // here would bury the real differences under noise.
    const withExtra = [...theirs, { account: 'Suspense', debit: 999, credit: 0 }]
    const result = compareTrialBalance(
      ours([
        { code: '1000', name: 'Cash', balance: 250_000 },
        { code: '1100', name: 'Investments at cost', balance: 3_000_000 },
        { code: '3100', name: "Partners' capital", balance: -3_250_000 },
      ]),
      withExtra,
      MAPPING,
    )
    expect(result.ties).toBe(true)
  })

  it('ignores sub-cent rounding', () => {
    const result = compareTrialBalance(
      ours([
        { code: '1000', name: 'Cash', balance: 250_000.004 },
        { code: '1100', name: 'Investments at cost', balance: 3_000_000 },
        { code: '3100', name: "Partners' capital", balance: -3_250_000 },
      ]),
      theirs,
      MAPPING,
    )
    expect(result.ties).toBe(true)
  })
})
