import { describe, it, expect } from 'vitest'
import { renderDigest, undeliveredKeys } from './digest'
import type { ReminderItem } from './types'

const item = (o: Partial<ReminderItem>): ReminderItem => ({
  source: 'compliance', keys: [], title: 'Form ADV Annual Amendment', dueDate: '2027-03-31',
  state: 'upcoming', href: '/compliance', ...o,
})

describe('undeliveredKeys', () => {
  it('returns keys not yet logged, across items, without duplicates', () => {
    const items = [item({ keys: ['a', 'b'] }), item({ keys: ['b', 'c'] })]
    expect(undeliveredKeys(items, new Set(['a']))).toEqual(['b', 'c'])
  })
  it('is empty when everything was sent', () => {
    expect(undeliveredKeys([item({ keys: ['a'] })], new Set(['a']))).toEqual([])
  })
})

describe('renderDigest', () => {
  const opts = { fundName: 'Hemrock Ventures', baseUrl: 'https://app.example.com', today: '2027-03-17' }

  it('leads the subject with the most urgent item', () => {
    const { subject } = renderDigest([
      item({ title: 'Form ADV Annual Amendment', dueDate: '2027-03-31', state: 'upcoming' }),
      item({ title: 'Form 13F', dueDate: '2027-03-10', state: 'overdue' }),
    ], opts)
    expect(subject).toBe('Hemrock Ventures: Form 13F overdue + 1 more')
  })

  it('phrases due-today and due-in-N', () => {
    expect(renderDigest([item({ dueDate: '2027-03-17', state: 'due_soon' })], opts).subject)
      .toBe('Hemrock Ventures: Form ADV Annual Amendment due today')
    expect(renderDigest([item({ dueDate: '2027-03-20', state: 'due_soon' })], opts).subject)
      .toBe('Hemrock Ventures: Form ADV Annual Amendment due in 3 days')
  })

  it('uses an asks item title as-is', () => {
    const { subject } = renderDigest([item({ source: 'asks_send', title: 'Send the Q1 2027 portfolio data request', state: 'overdue', dueDate: '2027-04-05' })], { ...opts, today: '2027-04-10' })
    expect(subject).toBe('Hemrock Ventures: Send the Q1 2027 portfolio data request')
  })

  it('groups by state, links each item, and escapes HTML', () => {
    const { html } = renderDigest([
      item({ title: 'A <b>', state: 'overdue', dueDate: '2027-03-10' }),
      item({ title: 'B', state: 'upcoming', href: '/requests' }),
    ], opts)
    expect(html).toContain('Overdue')
    expect(html).toContain('Upcoming')
    expect(html).not.toContain('Due soon')
    expect(html).toContain('A &lt;b&gt;')
    expect(html).toContain('https://app.example.com/requests')
    expect(html).toContain('https://app.example.com/settings')
    expect(html.indexOf('Overdue')).toBeLessThan(html.indexOf('Upcoming'))
  })
})
