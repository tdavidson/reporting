import { describe, it, expect } from 'vitest'
import { expandInstances, groupKey, occurrencesForYear, parseGroupKey, type ScheduleItem } from './schedule'

const item = (o: Partial<ScheduleItem> & { id: string }): ScheduleItem => ({
  frequency: 'Annual', scope: 'firm', deadline_month: null, deadline_day: null, rolling_days: null, ...o,
})

describe('group keys', () => {
  it('round-trips firm, vehicle, quarterly and vehicle-quarterly keys', () => {
    for (const [pg, q, key] of [['', 0, ''], ['Fund II', 0, 'Fund II'], ['', 3, 'Q3'], ['Fund II', 3, 'Fund II::Q3']] as const) {
      expect(groupKey(pg, q)).toBe(key)
      expect(parseGroupKey(key)).toEqual({ portfolioGroup: pg, quarter: q })
    }
  })
  it('does not mistake a vehicle named like a quarter suffix', () => {
    expect(parseGroupKey('Fund Q1')).toEqual({ portfolioGroup: 'Fund Q1', quarter: 0 })
  })
})

describe('expandInstances', () => {
  const groups = ['Fund I', 'Fund II']

  it('firm annual: one instance in its deadline month', () => {
    expect(expandInstances([item({ id: 'form-adv', deadline_month: 3 })], groups, {}))
      .toEqual([{ item: expect.objectContaining({ id: 'form-adv' }), group: undefined, months: [3] }])
  })

  it('vehicle annual: one per vehicle', () => {
    const out = expandInstances([item({ id: 'x', scope: 'vehicle', deadline_month: 4 })], groups, {})
    expect(out.map(i => i.group)).toEqual(['Fund I', 'Fund II'])
  })

  it('annual without a month: an instance with no months (list view only)', () => {
    expect(expandInstances([item({ id: 'insurance-eo' })], groups, {})[0].months).toEqual([])
  })

  it('firm quarterly: Q1..Q4 in the default months', () => {
    const out = expandInstances([item({ id: 'q', frequency: 'Quarterly' })], groups, {})
    expect(out.map(i => [i.group, i.months])).toEqual([['Q1', [1]], ['Q2', [4]], ['Q3', [7]], ['Q4', [10]]])
  })

  it('uses per-item quarterly months', () => {
    const out = expandInstances([item({ id: 'valuations-soi', frequency: 'Quarterly' })], groups, {})
    expect(out.map(i => i.months[0])).toEqual([3, 6, 9, 12])
  })

  it('treats Form 13F as quarterly despite its deadline_month', () => {
    const out = expandInstances([item({ id: 'form-13f', frequency: 'Quarterly', deadline_month: 2, deadline_day: 17 })], groups, {})
    expect(out.map(i => [i.group, i.months[0]])).toEqual([['Q1', 2], ['Q2', 5], ['Q3', 8], ['Q4', 11]])
  })

  it('vehicle quarterly: vehicles × quarters', () => {
    const out = expandInstances([item({ id: 'q', frequency: 'Quarterly', scope: 'vehicle' })], groups, {})
    expect(out.map(i => i.group)).toEqual([
      'Fund I::Q1', 'Fund I::Q2', 'Fund I::Q3', 'Fund I::Q4',
      'Fund II::Q1', 'Fund II::Q2', 'Fund II::Q3', 'Fund II::Q4',
    ])
  })

  it('event-driven: only vehicles with closes, in their close months', () => {
    const out = expandInstances([item({ id: 'form-d', frequency: 'Event-driven' })], groups, { 'Fund II': [3, 6], 'Fund I': [] })
    expect(out).toEqual([{ item: expect.objectContaining({ id: 'form-d' }), group: 'Fund II', months: [3, 6] }])
  })
})

describe('occurrencesForYear', () => {
  const opts = (year: number, closeDates: Record<string, string[]> = {}) => ({ year, portfolioGroups: ['Fund II'], closeDates })

  it('fixed-date annual', () => {
    const [o] = occurrencesForYear([item({ id: 'form-adv', deadline_month: 3, deadline_day: 31 })], opts(2027))
    expect(o).toMatchObject({ groupKey: '', portfolioGroup: '', quarter: 0, year: 2027, dueDate: '2027-03-31' })
  })

  it('defaults a missing deadline_day to month end', () => {
    const [o] = occurrencesForYear([item({ id: 'x', deadline_month: 2 })], opts(2026))
    expect(o.dueDate).toBe('2026-02-28')
  })

  it('quarterly due dates come from QUARTERLY_DUE', () => {
    const out = occurrencesForYear([item({ id: 'form-13f', frequency: 'Quarterly', deadline_month: 2 })], opts(2026))
    expect(out.map(o => [o.groupKey, o.dueDate])).toEqual([
      ['Q1', '2026-02-14'], ['Q2', '2026-05-15'], ['Q3', '2026-08-14'], ['Q4', '2026-11-14'],
    ])
  })

  it('event-driven: first close this year + rolling_days', () => {
    const out = occurrencesForYear(
      [item({ id: 'form-d', frequency: 'Event-driven', scope: 'vehicle', rolling_days: 15 })],
      opts(2026, { 'Fund II': ['2025-11-01', '2026-03-10', '2026-06-01'] }),
    )
    expect(out.map(o => [o.groupKey, o.dueDate, o.year])).toEqual([['Fund II', '2026-03-25', 2026]])
  })

  it('event-driven without rolling_days or without a close this year: none', () => {
    expect(occurrencesForYear([item({ id: 'boi', frequency: 'Event-driven' })], opts(2026, { 'Fund II': ['2026-03-10'] }))).toEqual([])
    expect(occurrencesForYear([item({ id: 'form-d', frequency: 'Event-driven', rolling_days: 15 })], opts(2026, { 'Fund II': ['2025-03-10'] }))).toEqual([])
  })

  it('annual without a month: none', () => {
    expect(occurrencesForYear([item({ id: 'insurance-eo' })], opts(2026))).toEqual([])
  })
})
