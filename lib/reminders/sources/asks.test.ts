import { describe, it, expect } from 'vitest'
import { asksSendReminders, type AsksData } from './asks-send'
import { asksFollowupReminders } from './asks-followup'
import { responseKey } from '@/lib/requests/response-status'

const asks = (o: Partial<AsksData> = {}): AsksData => ({
  sendOffsetDays: 5,
  requests: [],
  companies: [{ id: 'a', name: 'Acme' }],
  hasData: new Set(),
  overrides: new Map(),
  ...o,
})

describe('asksSendReminders', () => {
  it('nudges once the offset after quarter end has passed', () => {
    expect(asksSendReminders(asks(), '2026-07-10')).toEqual([{
      source: 'asks_send',
      keys: ['as:2026Q2:2026-07-05:t0'],
      title: 'Send the Q2 2026 portfolio data request',
      detail: '1 active company',
      dueDate: '2026-07-05',
      state: 'overdue',
      href: '/requests',
    }])
  })

  it('is silent before the offset', () => {
    expect(asksSendReminders(asks(), '2026-07-03')).toEqual([])
  })

  it('stops once a request for the quarter is sent', () => {
    const requests = [{ quarter: 2, year: 2026, due_date: null, status: 'sent' }]
    expect(asksSendReminders(asks({ requests }), '2026-07-10')).toEqual([])
  })

  it('does not count a request for another quarter, or a test send with no quarter', () => {
    const requests = [
      { quarter: 1, year: 2026, due_date: null, status: 'sent' },
      { quarter: null, year: null, due_date: null, status: 'sent' },
    ]
    expect(asksSendReminders(asks({ requests }), '2026-07-10')).toHaveLength(1)
  })

  it('re-arms weekly', () => {
    expect(asksSendReminders(asks(), '2026-07-20')[0].keys)
      .toEqual(['as:2026Q2:2026-07-05:t0', 'as:2026Q2:2026-07-05:od1', 'as:2026Q2:2026-07-05:od2'])
  })

  it('is silent with no active companies', () => {
    expect(asksSendReminders(asks({ companies: [] }), '2026-07-10')).toEqual([])
  })

  // The quarter's last day is not a day to have sent it already: offset 0 still opens the day after.
  it('with offset 0, opens the day after quarter end as due, not overdue', () => {
    const [item] = asksSendReminders(asks({ sendOffsetDays: 0 }), '2026-07-01')
    expect(item).toMatchObject({ dueDate: '2026-07-01', state: 'due_soon', keys: ['as:2026Q2:2026-07-01:t0'] })
  })

  it('next quarter end supersedes the nudge', () => {
    // Q2 was never sent; once Q3 has ended (and its offset passed) the nudge is about Q3.
    const [item] = asksSendReminders(asks(), '2026-10-10')
    expect(item.title).toBe('Send the Q3 2026 portfolio data request')
    expect(item.keys.every(key => key.startsWith('as:2026Q3:'))).toBe(true)
    expect(item.dueDate).toBe('2026-10-05')
  })
})

describe('asksFollowupReminders', () => {
  const sent = { quarter: 2, year: 2026, due_date: '2026-07-31', status: 'sent' }
  const k = (id: string) => responseKey(id, 2026, 2)
  const companies = [
    { id: 'a', name: 'Acme' },     // reported
    { id: 'b', name: 'Beta' },     // outstanding
    { id: 'c', name: 'Cobalt' },   // N/A
    { id: 'd', name: 'Delta' },    // waived
    { id: 'e', name: 'Echo' },     // waived, then reported
  ]
  const base = asks({
    requests: [sent],
    companies,
    hasData: new Set([k('a'), k('e')]),
    overrides: new Map([[k('c'), 'na'], [k('d'), 'waived'], [k('e'), 'waived']]),
  })

  it('lists only outstanding companies', () => {
    expect(asksFollowupReminders(base, '2026-07-28')).toEqual([{
      source: 'asks_followup',
      keys: ['af:2026Q2:2026-07-31:t7', 'af:2026Q2:2026-07-31:t3'],
      title: "Q2 2026 data request: 1 company hasn't responded",
      detail: 'Beta',
      dueDate: '2026-07-31',
      state: 'due_soon',
      href: '/requests',
    }])
  })

  it('stops when everyone is resolved', () => {
    const overrides = new Map(base.overrides).set(k('b'), 'waived')
    expect(asksFollowupReminders({ ...base, overrides }, '2026-08-20')).toEqual([])
  })

  it('is silent more than 7 days before the due date', () => {
    expect(asksFollowupReminders(base, '2026-07-20')).toEqual([])
  })

  it('needs a due date', () => {
    expect(asksFollowupReminders({ ...base, requests: [{ ...sent, due_date: null }] }, '2026-07-28')).toEqual([])
  })

  it('uses the latest due date when a quarter was sent more than once', () => {
    const requests = [sent, { ...sent, due_date: '2026-08-15' }]
    expect(asksFollowupReminders({ ...base, requests }, '2026-08-10')[0].dueDate).toBe('2026-08-15')
  })

  it('truncates a long list', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, name: `Co ${i}` }))
    const [item] = asksFollowupReminders(asks({ requests: [sent], companies: many }), '2026-07-28')
    expect(item.title).toBe("Q2 2026 data request: 12 companies haven't responded")
    expect(item.detail).toBe('Co 0, Co 1, Co 2, Co 3, Co 4, Co 5, Co 6, Co 7, Co 8, Co 9, +2 more')
  })
})
