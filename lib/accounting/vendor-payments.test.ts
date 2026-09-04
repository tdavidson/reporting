import { describe, it, expect } from 'vitest'
import { vendorPayments, vendorPaymentsRows } from './vendor-payments'

const vendors = [
  { id: 'law', name: 'Acme LLP', is1099Eligible: true, tinOnFile: false },
  { id: 'saas', name: 'Cloud Inc', is1099Eligible: false, tinOnFile: false },
  { id: 'cpa', name: 'Bean Counters', is1099Eligible: true, tinOnFile: true },
]
const cash = new Set(['cash'])
const e = (id: string, date: string, vendorId: string | null, cashAmount: number) => ({
  id, entryDate: date, memo: id, vendorId,
  postings: [{ accountId: 'cash', amount: cashAmount }, { accountId: 'exp', amount: -cashAmount }],
})

describe('vendorPayments', () => {
  it('sums cash credits per vendor in the year, nets refunds, and flags the rows to chase', () => {
    const entries = [
      e('e1', '2025-02-01', 'law', -5000),
      e('e2', '2025-06-01', 'law', 500),          // a refund
      e('e3', '2025-03-01', 'cpa', -700),
      e('e4', '2025-03-15', 'saas', -1200),
      e('e5', '2024-12-31', 'law', -9999),        // prior year
      { id: 'e6', entryDate: '2025-04-01', memo: 'accrual', vendorId: 'law', postings: [{ accountId: 'exp', amount: 300 }, { accountId: 'ap', amount: -300 }] }, // no cash
      e('e7', '2025-05-01', null, -50),           // no vendor
    ]
    const r = vendorPayments(entries, vendors, cash, { start: '2025-01-01', end: '2025-12-31' })
    expect(r.rows.map(x => [x.name, x.paid, x.entries, x.reportable, x.needsW9])).toEqual([
      ['Acme LLP', 4500, 2, true, true],
      ['Cloud Inc', 1200, 1, false, false],
      ['Bean Counters', 700, 1, true, false],
    ])
    expect(r.totalPaid).toBe(6400)
  })

  it('does not report an eligible vendor paid under the threshold', () => {
    const r = vendorPayments([e('e1', '2025-02-01', 'law', -599.99)], vendors, cash)
    expect(r.rows[0].reportable).toBe(false)
    expect(r.rows[0].needsW9).toBe(false)
  })

  it('lays out the worksheet with a total', () => {
    const rows = vendorPaymentsRows(vendorPayments([e('e1', '2025-02-01', 'cpa', -700)], vendors, cash))
    expect(rows[1]).toEqual(['Bean Counters', 700, 1, 'yes', 'yes', 'yes', ''])
    expect(rows[2][0]).toBe('Total')
    expect(rows[2][1]).toBe(700)
  })
})
