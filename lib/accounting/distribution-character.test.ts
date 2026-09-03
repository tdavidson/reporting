import { describe, it, expect } from 'vitest'
import {
  K1_BOX_19_CODE,
  UNCHARACTERISED,
  characterForLine,
  characterFromRow,
  characterTotal,
  isDistributionKind,
  isUncharacterised,
  validateCharacter,
} from './distribution-character'

describe('distribution character', () => {
  describe('validateCharacter', () => {
    it('accepts a split that sums to the total', () => {
      const c = { returnOfCapital: 600_000, realizedGain: 350_000, income: 50_000 }
      expect(validateCharacter(c, 1_000_000)).toBeNull()
    })

    it('accepts all-zero as a deliberate refusal to characterise', () => {
      // Every distribution declared before the character columns existed is in this state.
      expect(validateCharacter(UNCHARACTERISED, 1_000_000)).toBeNull()
    })

    it('refuses a split that does not sum to the total', () => {
      const c = { returnOfCapital: 600_000, realizedGain: 300_000, income: 0 }
      const problem = validateCharacter(c, 1_000_000)
      expect(problem?.error).toContain('900000.00')
      expect(problem?.error).toContain('1000000.00')
    })

    it('tolerates a cent, because three buckets are typed by hand', () => {
      const c = { returnOfCapital: 333_333.33, realizedGain: 333_333.33, income: 333_333.34 }
      expect(validateCharacter(c, 1_000_000)).toBeNull()
    })

    it('refuses more than a cent', () => {
      const c = { returnOfCapital: 500_000, realizedGain: 499_999.9, income: 0 }
      expect(validateCharacter(c, 1_000_000)?.error).toContain('must sum')
    })

    it('refuses a negative bucket', () => {
      const c = { returnOfCapital: 1_100_000, realizedGain: -100_000, income: 0 }
      expect(validateCharacter(c, 1_000_000)?.error).toContain('cannot be negative')
    })

    it('refuses a non-finite bucket', () => {
      const c = { returnOfCapital: Number.NaN, realizedGain: 0, income: 0 }
      expect(validateCharacter(c, 1_000_000)?.error).toContain('must be a number')
    })
  })

  describe('characterForLine', () => {
    it('splits each bucket pro-rata to the frozen line amount', () => {
      const c = { returnOfCapital: 600_000, realizedGain: 350_000, income: 50_000 }
      const share = characterForLine(c, 250_000, 1_000_000)
      expect(share).toEqual({ returnOfCapital: 150_000, realizedGain: 87_500, income: 12_500 })
      expect(characterTotal(share)).toBe(250_000)
    })

    it('keeps an uncharacterised distribution uncharacterised', () => {
      // Not three zeroes that look stated — the partner's share is unknown, same as the whole.
      expect(characterForLine(UNCHARACTERISED, 250_000, 1_000_000)).toEqual(UNCHARACTERISED)
    })

    it('does not divide by a zero total', () => {
      const c = { returnOfCapital: 100, realizedGain: 0, income: 0 }
      expect(characterForLine(c, 0, 0)).toEqual(UNCHARACTERISED)
    })

    it('rounds each bucket to cents', () => {
      const c = { returnOfCapital: 1_000, realizedGain: 0, income: 0 }
      const share = characterForLine(c, 1, 3)
      expect(share.returnOfCapital).toBe(333.33)
    })
  })

  describe('isUncharacterised', () => {
    it('is true only when every bucket is zero', () => {
      expect(isUncharacterised(UNCHARACTERISED)).toBe(true)
      expect(isUncharacterised({ returnOfCapital: 0, realizedGain: 0.01, income: 0 })).toBe(false)
    })
  })

  describe('characterFromRow', () => {
    it('reads numeric strings, which is how postgres numeric arrives', () => {
      expect(
        characterFromRow({ char_return_of_capital: '600000', char_realized_gain: '400000', char_income: null }),
      ).toEqual({ returnOfCapital: 600_000, realizedGain: 400_000, income: 0 })
    })

    it('treats a row with no character columns as uncharacterised', () => {
      expect(characterFromRow({})).toEqual(UNCHARACTERISED)
    })
  })

  describe('kind', () => {
    it('maps to the K-1 box 19 codes', () => {
      expect(K1_BOX_19_CODE.cash).toBe('A')
      expect(K1_BOX_19_CODE.in_kind).toBe('B')
      expect(K1_BOX_19_CODE.other).toBe('C')
    })

    it('rejects anything not a known kind', () => {
      expect(isDistributionKind('cash')).toBe(true)
      expect(isDistributionKind('crypto')).toBe(false)
      expect(isDistributionKind(undefined)).toBe(false)
    })
  })
})
