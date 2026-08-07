import { describe, it, expect } from 'vitest'
import { deriveFofActive } from './fof'

describe('deriveFofActive', () => {
  it('is off for a fund with no fund holdings', () => {
    expect(deriveFofActive({ fundHoldingCount: 0 })).toBe(false)
  })

  it('turns on with the first fund holding', () => {
    expect(deriveFofActive({ fundHoldingCount: 1 })).toBe(true)
    expect(deriveFofActive({ fundHoldingCount: 23 })).toBe(true)
  })

  it('treats a negative or non-finite count as off rather than throwing', () => {
    // A failed count query must not light up FoF surfaces on a fund that has none.
    expect(deriveFofActive({ fundHoldingCount: -1 })).toBe(false)
    expect(deriveFofActive({ fundHoldingCount: NaN })).toBe(false)
  })
})
