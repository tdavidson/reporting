import { describe, it, expect } from 'vitest'
import { transactionForEvent, transactionForNav } from './fof-register'

const call = {
  companyId: 'f1', kind: 'call' as const, eventDate: '2025-06-30', amount: 1_000_000,
  recallableAmount: 0, charReturnOfCapital: 0, charRealizedGain: 0, charIncome: 0,
  purposeInvestments: 900_000, purposeFees: 80_000, purposeExpenses: 20_000,
}

const dist = {
  companyId: 'f1', kind: 'distribution' as const, eventDate: '2025-09-30', amount: 500_000,
  recallableAmount: 100_000, charReturnOfCapital: 350_000, charRealizedGain: 150_000, charIncome: 0,
  purposeInvestments: 0, purposeFees: 0, purposeExpenses: 0,
}

describe('transactionForEvent', () => {
  it('maps a capital call to an investment at full cost, fees included', () => {
    const t = transactionForEvent(call, { ledgerStartDate: null })!
    expect(t.transaction_type).toBe('investment')
    expect(t.transaction_date).toBe('2025-06-30')
    // The WHOLE call capitalizes under ASC 946 — management fees called by the underlying
    // manager are part of our cost basis, not our expense.
    expect(t.investment_cost).toBe(1_000_000)
  })

  it('maps a distribution to proceeds, with return-of-capital as the basis retired', () => {
    const t = transactionForEvent(dist, { ledgerStartDate: null })!
    expect(t.transaction_type).toBe('proceeds')
    expect(t.proceeds_received).toBe(500_000)
    expect(t.cost_basis_exited).toBe(350_000)   // the ROC character, not the whole distribution
  })

  it('produces nothing for an event before the ledger start date', () => {
    // Migrated history: QuickBooks already posted these entries (Plan 3). Re-posting would
    // double-count. The event still counts for every derived metric — it just posts nothing.
    expect(transactionForEvent(call, { ledgerStartDate: '2026-01-01' })).toBeNull()
  })

  it('produces a transaction for an event exactly on the ledger start date', () => {
    expect(transactionForEvent(call, { ledgerStartDate: '2025-06-30' })).not.toBeNull()
  })

  it('refuses a distribution whose character split does not sum to the amount', () => {
    const bad = { ...dist, charRealizedGain: 999 }
    expect(() => transactionForEvent(bad, { ledgerStartDate: null }))
      .toThrow(/character split/i)
  })

  it('refuses a call whose purpose split does not sum to the amount', () => {
    const bad = { ...call, purposeFees: 1 }
    expect(() => transactionForEvent(bad, { ledgerStartDate: null }))
      .toThrow(/purpose split/i)
  })
})

describe('transactionForNav', () => {
  const nav = { companyId: 'f1', asOfDate: '2025-09-30', reportedNav: 4_000_000, basis: 'final' as const }

  it('marks the delta between derived carrying value and what the ledger carries', () => {
    const t = transactionForNav(nav, { carriedValue: 3_600_000, ledgerStartDate: null })!
    expect(t.transaction_type).toBe('unrealized_gain_change')
    expect(t.unrealized_value_change).toBe(400_000)
    expect(t.transaction_date).toBe('2025-09-30')
  })

  it('marks a decline as a negative change', () => {
    const t = transactionForNav(nav, { carriedValue: 4_250_000, ledgerStartDate: null })!
    expect(t.unrealized_value_change).toBe(-250_000)
  })

  it('produces nothing when the ledger already agrees', () => {
    expect(transactionForNav(nav, { carriedValue: 4_000_000, ledgerStartDate: null })).toBeNull()
  })

  it('produces nothing for a statement before the ledger start date', () => {
    expect(transactionForNav(nav, { carriedValue: 0, ledgerStartDate: '2026-01-01' })).toBeNull()
  })
})
