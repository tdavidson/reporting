import { describe, it, expect } from 'vitest'
import { isOutstanding, lastEndedQuarter, metricQuarter, parseDueDate, resolveResponseStatus } from './response-status'

describe('resolveResponseStatus', () => {
  it('auto-detects from data when there is no override', () => {
    expect(resolveResponseStatus(true, undefined)).toBe('yes')
    expect(resolveResponseStatus(false, undefined)).toBe('no')
  })
  it('honours na and waived overrides without data', () => {
    expect(resolveResponseStatus(false, 'na')).toBe('na')
    expect(resolveResponseStatus(false, 'waived')).toBe('waived')
  })
  it('lets real data beat a waived override', () => {
    expect(resolveResponseStatus(true, 'waived')).toBe('yes')
  })
  it('keeps other overrides as they were (override wins)', () => {
    expect(resolveResponseStatus(true, 'no')).toBe('no')
    expect(resolveResponseStatus(true, 'na')).toBe('na')
  })
  it('ignores an unknown override value', () => {
    expect(resolveResponseStatus(false, 'bogus')).toBe('no')
  })
})

describe('isOutstanding', () => {
  it('only "no" is outstanding', () => {
    expect(['yes', 'no', 'na', 'waived'].map(s => isOutstanding(s as any))).toEqual([false, true, false, false])
  })
})

describe('metricQuarter', () => {
  it('prefers period_quarter, falls back to the month', () => {
    expect(metricQuarter({ period_quarter: 2, period_month: 12 })).toBe(2)
    expect(metricQuarter({ period_quarter: null, period_month: 8 })).toBe(3)
    expect(metricQuarter({ period_quarter: null, period_month: null })).toBeNull()
  })
})

describe('lastEndedQuarter', () => {
  it('is the most recently completed calendar quarter', () => {
    expect(lastEndedQuarter('2026-09-18')).toEqual({ year: 2026, quarter: 2, endDate: '2026-06-30' })
    expect(lastEndedQuarter('2026-09-30')).toEqual({ year: 2026, quarter: 2, endDate: '2026-06-30' })
    expect(lastEndedQuarter('2026-10-01')).toEqual({ year: 2026, quarter: 3, endDate: '2026-09-30' })
    expect(lastEndedQuarter('2026-01-05')).toEqual({ year: 2025, quarter: 4, endDate: '2025-12-31' })
  })
})

// Postgres rejects an impossible date, so the regex alone let 2026-02-30 through to an insert that
// failed after the emails had gone out — no row, and no reminders for the quarter.
describe('parseDueDate', () => {
  it('accepts a real calendar date', () => {
    expect(parseDueDate('2026-02-28')).toBe('2026-02-28')
    expect(parseDueDate('2028-02-29')).toBe('2028-02-29')
  })
  it('rejects a date that does not exist', () => {
    expect(parseDueDate('2026-02-30')).toBeNull()
    expect(parseDueDate('2026-02-29')).toBeNull()
    expect(parseDueDate('2026-04-31')).toBeNull()
    expect(parseDueDate('2026-02-32')).toBeNull()
    expect(parseDueDate('2026-13-01')).toBeNull()
  })
  it('rejects empty, malformed and non-string input', () => {
    for (const v of ['', '2026-2-3', '2026/02/03', '2026-02-03T00:00:00Z', ' 2026-02-03', 'soon', null, undefined, 20260203]) {
      expect(parseDueDate(v)).toBeNull()
    }
  })
})
