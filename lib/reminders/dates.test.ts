import { describe, it, expect } from 'vitest'
import { addDays, daysBetween, isoDate, monthEnd, ymd } from './dates'

describe('reminder dates', () => {
  it('formats a Date as its UTC calendar day', () => {
    expect(isoDate(new Date('2026-09-18T23:30:00Z'))).toBe('2026-09-18')
  })
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('counts days from → to', () => {
    expect(daysBetween('2027-03-17', '2027-03-31')).toBe(14)
    expect(daysBetween('2027-04-15', '2027-03-31')).toBe(-15)
  })
  it('knows month ends, including leap years', () => {
    expect(monthEnd(2028, 2)).toBe(29)
    expect(monthEnd(2026, 2)).toBe(28)
    expect(monthEnd(2026, 12)).toBe(31)
  })
  it('clamps the day to the month', () => {
    expect(ymd(2026, 2, 31)).toBe('2026-02-28')
    expect(ymd(2026, 5, 15)).toBe('2026-05-15')
  })
})
