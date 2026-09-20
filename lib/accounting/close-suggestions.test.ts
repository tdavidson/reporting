import { describe, expect, it } from 'vitest'
import { scheduledMonth } from './close-suggestions'

describe('scheduledMonth', () => {
  it('preserves the requested monthly recognition day', () => {
    expect(scheduledMonth('2026-03-05', 1, 5)).toBe('2026-04-05')
  })

  it('uses month end when the requested day does not exist', () => {
    expect(scheduledMonth('2026-01-31', 1, 31)).toBe('2026-02-28')
    expect(scheduledMonth('2028-01-31', 1, 31)).toBe('2028-02-29')
  })

  it('can move backward for recurring-pattern lookback', () => {
    expect(scheduledMonth('2026-09-30', -6, 1)).toBe('2026-03-01')
  })
})
