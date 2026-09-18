import { describe, it, expect } from 'vitest'
import { crossedThresholds, stateFor } from './thresholds'

describe('crossedThresholds', () => {
  const due = '2027-03-31'
  it('is empty before the first threshold', () => {
    expect(crossedThresholds(due, '2027-02-28', [30, 14, 3])).toEqual([])
  })
  it('fires a threshold on its day, not the day before', () => {
    expect(crossedThresholds(due, '2027-03-16', [30, 14, 3])).toEqual(['t30'])
    expect(crossedThresholds(due, '2027-03-17', [30, 14, 3])).toEqual(['t30', 't14'])
  })
  it('adds t0 on the due day', () => {
    expect(crossedThresholds(due, due, [30, 14, 3])).toEqual(['t30', 't14', 't3', 't0'])
  })
  it('adds one key per full overdue week', () => {
    expect(crossedThresholds(due, '2027-04-06', [3])).toEqual(['t3', 't0'])
    expect(crossedThresholds(due, '2027-04-07', [3])).toEqual(['t3', 't0', 'od1'])
    expect(crossedThresholds(due, '2027-04-15', [3])).toEqual(['t3', 't0', 'od1', 'od2'])
  })
  it('works with no lead thresholds (a nudge date)', () => {
    expect(crossedThresholds('2026-07-05', '2026-07-05', [])).toEqual(['t0'])
  })
})

describe('stateFor', () => {
  it('classifies by days until due', () => {
    expect(stateFor('2027-03-31', '2027-04-01')).toBe('overdue')
    expect(stateFor('2027-03-31', '2027-03-31')).toBe('due_soon')
    expect(stateFor('2027-03-31', '2027-03-24')).toBe('due_soon')
    expect(stateFor('2027-03-31', '2027-03-23')).toBe('upcoming')
  })
})
