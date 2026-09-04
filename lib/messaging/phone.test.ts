import { describe, expect, it } from 'vitest'
import { maskPhoneNumber, normalizePhoneNumber } from './phone'

describe('normalizePhoneNumber', () => {
  it('reads a bare ten-digit number as North American', () => {
    expect(normalizePhoneNumber('(415) 555-2671')).toBe('+14155552671')
    expect(normalizePhoneNumber('415.555.2671')).toBe('+14155552671')
    expect(normalizePhoneNumber('1 415 555 2671')).toBe('+14155552671')
  })

  it('keeps an international number as dialled', () => {
    expect(normalizePhoneNumber('+44 20 7946 0958')).toBe('+442079460958')
    expect(normalizePhoneNumber('+14155552671')).toBe('+14155552671')
  })

  it('refuses what cannot be a number', () => {
    expect(normalizePhoneNumber('')).toBeNull()
    expect(normalizePhoneNumber('call me')).toBeNull()
    expect(normalizePhoneNumber('12345')).toBeNull()
    expect(normalizePhoneNumber('+0 123 456 7890')).toBeNull()
  })
})

describe('maskPhoneNumber', () => {
  it('shows the country code and the last four', () => {
    expect(maskPhoneNumber('+14155552671')).toBe('+1 ••• ••• 2671')
    expect(maskPhoneNumber('not a number')).toBe('not a number')
  })
})
