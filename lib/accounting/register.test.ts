import { describe, it, expect } from 'vitest'
import { accountRegister, findAccount, type RegisterPosting } from './register'
import { trialBalance } from './statements'
import type { Account } from './types'

const acct = (id: string, code: string, name: string, type: Account['type']): Account =>
  ({ id, fundId: 'f', code, name, type })

const cash = acct('cash', '1000', 'Cash', 'asset')
const inv = acct('inv', '1100', 'Investments at cost', 'asset')
const lpA = acct('lpa', '3100-aaaa', "Partners' capital — A", 'equity')
const lpB = acct('lpb', '3100-bbbb', "Partners' capital — B", 'equity')
const fee = acct('fee', '5000', 'Management fee', 'expense')
const gp = acct('gp', '2100', 'Due to GP', 'liability')
const accounts = [cash, inv, lpA, lpB, fee, gp]
const byId = new Map(accounts.map(a => [a.id, a]))

const post = (entryId: string, entryDate: string, accountId: string, amount: number, memo = entryId): RegisterPosting =>
  ({ entryId, entryDate, accountId, amount, memo, sourceType: null })

// A small ledger: a call, a purchase, a fee accrual, a second call.
const ledger: RegisterPosting[] = [
  post('e1', '2025-01-15', 'cash', 1000, 'Capital call'),
  post('e1', '2025-01-15', 'lpa', -600, 'Capital call'),
  post('e1', '2025-01-15', 'lpb', -400, 'Capital call'),
  post('e2', '2025-02-01', 'inv', 800, 'Purchase'),
  post('e2', '2025-02-01', 'cash', -800, 'Purchase'),
  post('e3', '2025-03-31', 'fee', 50, 'Q1 fee'),
  post('e3', '2025-03-31', 'gp', -50, 'Q1 fee'),
  post('e4', '2025-04-10', 'cash', 500, 'Capital call 2'),
  post('e4', '2025-04-10', 'lpa', -300, 'Capital call 2'),
  post('e4', '2025-04-10', 'lpb', -200, 'Capital call 2'),
]

describe('accountRegister', () => {
  it('reads a debit-normal account the way a bank statement does', () => {
    const reg = accountRegister(cash, ledger, byId)
    expect(reg.opening).toBe(0)
    expect(reg.lines.map(l => l.running)).toEqual([1000, 200, 700])
    expect(reg.closing).toBe(700)
    expect(reg.totals).toEqual({ debit: 1500, credit: 800 })
    expect(reg.account.normalSide).toBe('debit')
  })

  it('reads a credit-normal account with credits increasing the balance', () => {
    const reg = accountRegister(lpA, ledger, byId)
    expect(reg.lines.map(l => l.change)).toEqual([600, 300])
    expect(reg.lines.map(l => l.running)).toEqual([600, 900])
    expect(reg.closing).toBe(900)
    // The raw columns are still there for the accountant.
    expect(reg.lines[0].credit).toBe(600)
    expect(reg.lines[0].debit).toBe(0)
  })

  it('carries the balance in at the window start and excludes postings after the end', () => {
    const reg = accountRegister(cash, ledger, byId, { start: '2025-02-01', end: '2025-03-31' })
    expect(reg.opening).toBe(1000) // the January call
    expect(reg.lines).toHaveLength(1)
    expect(reg.lines[0].entryId).toBe('e2')
    expect(reg.closing).toBe(200)
    // Opening + activity = the trial balance for the same as-of.
    const tb = trialBalance(accounts, ledger.filter(p => p.entryDate! <= '2025-03-31').map(p => ({ ...p, currency: 'USD' })))
    expect(tb.rows.find(r => r.accountId === 'cash')!.balance).toBe(reg.closing)
  })

  it('names the counter-accounts on each line, ordered by code', () => {
    const reg = accountRegister(cash, ledger, byId)
    expect(reg.lines[0].counterAccounts.map(c => c.code)).toEqual(['3100-aaaa', '3100-bbbb'])
    expect(reg.lines[1].counterAccounts.map(c => c.name)).toEqual(['Investments at cost'])
  })

  it('orders same-day lines by entry id so the running balance is reproducible', () => {
    const sameDay = [
      post('z', '2025-05-01', 'cash', 10),
      post('a', '2025-05-01', 'cash', 20),
    ]
    const reg = accountRegister(cash, sameDay, byId)
    expect(reg.lines.map(l => l.entryId)).toEqual(['a', 'z'])
    expect(reg.lines.map(l => l.running)).toEqual([20, 30])
  })

  it('keeps a posting with no date inside the window rather than dropping it', () => {
    const undated = [{ ...post('u', '2025-01-01', 'cash', 5), entryDate: null }]
    const reg = accountRegister(cash, undated, byId, { start: '2025-06-01', end: '2025-06-30' })
    expect(reg.lines).toHaveLength(1)
    expect(reg.closing).toBe(5)
  })

  it('closing ties to the trial balance for every account', () => {
    const tb = trialBalance(accounts, ledger.map(p => ({ ...p, currency: 'USD' })))
    for (const a of accounts) {
      const reg = accountRegister(a, ledger, byId)
      const row = tb.rows.find(r => r.accountId === a.id)
      expect(reg.closing).toBe(row ? row.balance : 0)
    }
  })
})

describe('findAccount', () => {
  it('resolves by id first, then by code', () => {
    expect(findAccount(accounts, 'cash')?.code).toBe('1000')
    expect(findAccount(accounts, '1100')?.id).toBe('inv')
    expect(findAccount(accounts, ' 5000 ')?.id).toBe('fee')
    expect(findAccount(accounts, '')).toBeUndefined()
    expect(findAccount(accounts, '9999')).toBeUndefined()
  })
})
