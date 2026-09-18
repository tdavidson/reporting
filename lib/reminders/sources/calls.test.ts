import { describe, it, expect } from 'vitest'
import { callsDueReminders, type OpenCall } from './calls'

const call = (o: Partial<OpenCall> = {}): OpenCall => ({
  id: 'c1', vehicleId: 'v1', vehicle: 'Fund I', callDate: '2026-09-01', dueDate: '2026-09-15', callNumber: 4,
  description: null, outstanding: 250_000, unfunded: ['Alpha Holdings', 'Beta Trust'], currency: 'USD', ...o,
})

describe('callsDueReminders', () => {
  it('opens three days before the due date and names who is behind', () => {
    expect(callsDueReminders({ openCalls: [call()] }, '2026-09-12')).toEqual([{
      source: 'calls_due',
      keys: ['cc:c1:2026-09-15:t3'],
      title: 'Capital call No. 4 — Fund I: USD 250,000.00 unfunded',
      detail: '2 partners outstanding: Alpha Holdings, Beta Trust',
      dueDate: '2026-09-15',
      state: 'due_soon',
      href: '/funds/v1/capital-accounts',
    }])
  })

  it('is silent earlier than that', () => {
    expect(callsDueReminders({ openCalls: [call()] }, '2026-09-10')).toEqual([])
  })

  it('re-arms on the due day and weekly after', () => {
    expect(callsDueReminders({ openCalls: [call()] }, '2026-09-29')[0].keys)
      .toEqual(['cc:c1:2026-09-15:t3', 'cc:c1:2026-09-15:t0', 'cc:c1:2026-09-15:od1', 'cc:c1:2026-09-15:od2'])
  })

  it('disappears once nothing is outstanding', () => {
    expect(callsDueReminders({ openCalls: [call({ outstanding: 0, unfunded: [] })] }, '2026-09-20')).toEqual([])
  })

  it('a partner paying does not change the keys', () => {
    const before = callsDueReminders({ openCalls: [call()] }, '2026-09-16')[0].keys
    const after = callsDueReminders({ openCalls: [call({ outstanding: 100_000, unfunded: ['Beta Trust'] })] }, '2026-09-16')[0].keys
    expect(after).toEqual(before)
  })

  it('falls back to the call date when the call has no number', () => {
    expect(callsDueReminders({ openCalls: [call({ callNumber: null })] }, '2026-09-15')[0].title)
      .toBe('Capital call of 2026-09-01 — Fund I: USD 250,000.00 unfunded')
  })
})
