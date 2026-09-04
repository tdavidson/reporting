import { describe, it, expect } from 'vitest'
import { EMPTY_FORM, formFromTransaction } from '@/components/investment-transaction-form'
import type { InvestmentTransaction } from '@/lib/types/database'

// The save handler calls `.trim()` on every numeric form field, so a key the edit path forgets
// is a crash on save, not a blank input. This was real: split/income/fee fields were added to
// the form and the payload but not to the edit path, and editing any existing row threw
// "Cannot read properties of undefined (reading 'trim')".
describe('formFromTransaction', () => {
  const sparse = {
    id: 't1',
    transaction_type: 'investment',
    round_name: 'Seed',
    transaction_date: '2026-01-01',
    investment_cost: 100000,
  } as unknown as InvestmentTransaction

  it('returns a string for every EMPTY_FORM key, even on a sparse row', () => {
    const form = formFromTransaction(sparse)
    for (const key of Object.keys(EMPTY_FORM)) {
      expect(typeof form[key], `form.${key}`).toBe('string')
    }
  })

  it('carries the split/income/fee fields through when present', () => {
    const form = formFromTransaction({
      ...sparse, split_ratio: 7, income_kind: 'dividend', income_settlement: 'cash',
      income_amount: 12.5, fee_amount: 3,
    } as unknown as InvestmentTransaction)
    expect(form.split_ratio).toBe('7')
    expect(form.income_kind).toBe('dividend')
    expect(form.income_settlement).toBe('cash')
    expect(form.income_amount).toBe('12.5')
    expect(form.fee_amount).toBe('3')
  })
})
