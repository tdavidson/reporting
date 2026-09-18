import { describe, it, expect } from 'vitest'
import { applySettlements, registerStatus, settlementsFromPostings } from './settlement'

const line = (id: string, lpEntityId: string, date: string, amount: number) => ({ id, lpEntityId, date, amount })

describe('applySettlements', () => {
  it('a wire settles the oldest open line first', () => {
    const out = applySettlements(
      [line('c2', 'a', '2026-03-01', 100), line('c1', 'a', '2026-01-01', 100)],
      [{ lpEntityId: 'a', date: '2026-03-10', amount: 100 }],
    )
    expect(out.get('c1')).toMatchObject({ status: 'settled', settled: 100, outstanding: 0, settledOn: '2026-03-10' })
    expect(out.get('c2')).toMatchObject({ status: 'open', settled: 0, outstanding: 100, settledOn: null })
  })

  it('one wire can fund several calls, and a call can be funded by several wires', () => {
    const out = applySettlements(
      [line('c1', 'a', '2026-01-01', 100), line('c2', 'a', '2026-02-01', 100), line('c3', 'a', '2026-03-01', 100)],
      [{ lpEntityId: 'a', date: '2026-02-05', amount: 150 }, { lpEntityId: 'a', date: '2026-03-05', amount: 75 }],
    )
    expect(out.get('c1')).toMatchObject({ status: 'settled', settledOn: '2026-02-05' })
    expect(out.get('c2')).toMatchObject({ status: 'settled', settled: 100, settledOn: '2026-03-05' })
    expect(out.get('c3')).toMatchObject({ status: 'partial', settled: 25, outstanding: 75, settledOn: null, lastSettlementOn: '2026-03-05' })
  })

  it('never crosses partners', () => {
    const out = applySettlements(
      [line('c1', 'a', '2026-01-01', 100), line('c2', 'b', '2026-01-01', 100)],
      [{ lpEntityId: 'b', date: '2026-01-05', amount: 100 }],
    )
    expect(out.get('c1')?.status).toBe('open')
    expect(out.get('c2')?.status).toBe('settled')
  })

  it('an overpayment is left over rather than invented onto a line', () => {
    const out = applySettlements([line('c1', 'a', '2026-01-01', 100)], [{ lpEntityId: 'a', date: '2026-01-05', amount: 250 }])
    expect(out.get('c1')).toMatchObject({ settled: 100, outstanding: 0 })
  })

  it('a line with no settlements at all is open', () => {
    const out = applySettlements([line('c1', 'a', '2026-01-01', 100)], [])
    expect(out.get('c1')).toMatchObject({ status: 'open', settled: 0, outstanding: 100 })
  })

  it('works to the cent', () => {
    const out = applySettlements(
      [line('c1', 'a', '2026-01-01', 33.33), line('c2', 'a', '2026-01-02', 33.34)],
      [{ lpEntityId: 'a', date: '2026-01-05', amount: 66.67 }],
    )
    expect(out.get('c1')?.status).toBe('settled')
    expect(out.get('c2')?.status).toBe('settled')
  })
})

describe('registerStatus', () => {
  it('rolls lines up and flags overdue only while something is outstanding', () => {
    const lines = [{ settled: 100, outstanding: 0 }, { settled: 20, outstanding: 80 }]
    expect(registerStatus(lines, '2026-01-31', '2026-02-15')).toEqual({ status: 'partial', settled: 120, outstanding: 80, overdue: true })
    expect(registerStatus(lines, '2026-02-28', '2026-02-15')).toMatchObject({ overdue: false })
    expect(registerStatus(lines, null, '2026-02-15')).toMatchObject({ overdue: false })
    expect(registerStatus([{ settled: 100, outstanding: 0 }], '2026-01-01', '2026-02-15')).toEqual({ status: 'settled', settled: 100, outstanding: 0, overdue: false })
  })
})

describe('settlementsFromPostings', () => {
  const postings = [
    { accountId: 'recv', amount: 100, lpEntityId: 'a', entryDate: '2026-01-01' },   // issuance: Dr receivable
    { accountId: 'recv', amount: -60, lpEntityId: 'a', entryDate: '2026-01-10' },   // funding: Cr receivable
    { accountId: 'cash', amount: 60, lpEntityId: null, entryDate: '2026-01-10' },
    { accountId: 'pay', amount: -50, lpEntityId: 'a', entryDate: '2026-02-01' },    // declaration: Cr payable
    { accountId: 'pay', amount: 50, lpEntityId: 'a', entryDate: '2026-02-09' },     // paid: Dr payable
  ]
  it('reads fundings off the receivable and payments off the payable, by sign', () => {
    expect(settlementsFromPostings(postings, 'recv', 'receivable')).toEqual([{ lpEntityId: 'a', date: '2026-01-10', amount: 60 }])
    expect(settlementsFromPostings(postings, 'pay', 'payable')).toEqual([{ lpEntityId: 'a', date: '2026-02-09', amount: 50 }])
  })
})
