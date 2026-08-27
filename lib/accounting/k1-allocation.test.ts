import { describe, it, expect } from 'vitest'
import {
  K1_BOX,
  K1_SUBSET_OF,
  allocateK1,
  capitalAccountFoots,
  emptyLines,
  incomeTotal,
  type FundYearCharacter,
  type PartnerYearActivity,
} from './k1-allocation'

const NO_CHARACTER: FundYearCharacter = {
  interest: 0,
  ordinaryDividends: 0,
  qualifiedDividends: 0,
  shortTermGain: 0,
  longTermGain: 0,
  otherIncome: 0,
  deductions: 0,
}

function partner(over: Partial<PartnerYearActivity> & Pick<PartnerYearActivity, 'lpEntityId'>): PartnerYearActivity {
  return {
    beginningCapital: 0,
    contributions: 0,
    distributions: 0,
    operatingIncome: 0,
    realizedGains: 0,
    expenses: 0,
    carriedInterest: 0,
    endingCapital: 0,
    ...over,
  }
}

describe('allocateK1', () => {
  it('splits character in proportion to the bucket it came from', () => {
    // The close allocated operating income 75/25. Interest and dividends follow that split,
    // because they ARE that income — not a separate thing to re-allocate.
    const res = allocateK1({
      fund: { ...NO_CHARACTER, interest: 40_000, ordinaryDividends: 60_000 },
      partners: [
        partner({ lpEntityId: 'lp-a', operatingIncome: 75_000 }),
        partner({ lpEntityId: 'lp-b', operatingIncome: 25_000 }),
      ],
    })
    const [a, b] = res.partners
    expect(a.lines.interest).toBe(30_000)
    expect(b.lines.interest).toBe(10_000)
    expect(a.lines.ordinaryDividends).toBe(45_000)
    expect(b.lines.ordinaryDividends).toBe(15_000)
  })

  it('splits gains by the gain bucket, not by the income bucket', () => {
    // A partner can take a different share of gains than of income — the close's per-category
    // participation is exactly why these are separate buckets.
    const res = allocateK1({
      fund: { ...NO_CHARACTER, longTermGain: 1_000_000 },
      partners: [
        partner({ lpEntityId: 'lp-a', operatingIncome: 90_000, realizedGains: 500_000 }),
        partner({ lpEntityId: 'lp-b', operatingIncome: 10_000, realizedGains: 500_000 }),
      ],
    })
    expect(res.partners[0].lines.longTermGain).toBe(500_000)
    expect(res.partners[1].lines.longTermGain).toBe(500_000)
  })

  it('ties every split to the fund total, to the cent', () => {
    // Three partners and an amount that does not divide: the remainder must land somewhere
    // rather than vanish.
    const res = allocateK1({
      fund: { ...NO_CHARACTER, interest: 100 },
      partners: [
        partner({ lpEntityId: 'a', operatingIncome: 1 }),
        partner({ lpEntityId: 'b', operatingIncome: 1 }),
        partner({ lpEntityId: 'c', operatingIncome: 1 }),
      ],
    })
    const total = res.partners.reduce((s, p) => s + p.lines.interest, 0)
    expect(Math.round(total * 100) / 100).toBe(100)
  })

  it('reports fund income that has no bucket to follow instead of dropping it', () => {
    // Dividends in a year no partner was allocated operating income. Silently omitting them is
    // the failure this guards against.
    const res = allocateK1({
      fund: { ...NO_CHARACTER, ordinaryDividends: 25_000 },
      partners: [partner({ lpEntityId: 'lp-a', realizedGains: 500_000 })],
    })
    expect(res.unallocated.ordinaryDividends).toBe(25_000)
    expect(res.partners[0].lines.ordinaryDividends).toBe(0)
  })

  it('splits a loss by magnitude of participation', () => {
    const res = allocateK1({
      fund: { ...NO_CHARACTER, shortTermGain: -200_000 },
      partners: [
        partner({ lpEntityId: 'lp-a', realizedGains: -150_000 }),
        partner({ lpEntityId: 'lp-b', realizedGains: -50_000 }),
      ],
    })
    expect(res.partners[0].lines.shortTermGain).toBe(-150_000)
    expect(res.partners[1].lines.shortTermGain).toBe(-50_000)
  })

  it('takes distributions from the partner, not from a share', () => {
    // Distributions were declared per partner and frozen. They are not re-derived here.
    const res = allocateK1({
      fund: NO_CHARACTER,
      partners: [partner({ lpEntityId: 'lp-a', distributions: 250_000 })],
    })
    expect(res.partners[0].lines.distributionsCash).toBe(250_000)
  })

  it('splits distributions by K-1 box 19 form when the kinds are known', () => {
    const res = allocateK1({
      fund: NO_CHARACTER,
      partners: [
        partner({
          lpEntityId: 'lp-a',
          distributions: 300_000,
          distributionsByKind: { cash: 200_000, property: 90_000, other: 10_000 },
        }),
      ],
    })
    const l = res.partners[0].lines
    expect([l.distributionsCash, l.distributionsProperty, l.distributionsOther]).toEqual([
      200_000, 90_000, 10_000,
    ])
  })

  it('treats an unsplit distribution as cash, which is what box 19 A covers', () => {
    const res = allocateK1({
      fund: NO_CHARACTER,
      partners: [partner({ lpEntityId: 'lp-a', distributions: 100_000 })],
    })
    expect(res.partners[0].lines.distributionsCash).toBe(100_000)
  })
})

describe('qualified dividends are a subset, not an addition', () => {
  it('is declared as a subset of ordinary dividends', () => {
    expect(K1_SUBSET_OF.qualifiedDividends).toBe('ordinaryDividends')
  })

  it('is excluded from the income total, so it cannot double-count', () => {
    const lines = emptyLines()
    lines.ordinaryDividends = 60_000
    lines.qualifiedDividends = 45_000
    expect(incomeTotal(lines)).toBe(60_000)
  })
})

describe('tie-out', () => {
  it('agrees when the character covers the allocated activity', () => {
    const res = allocateK1({
      fund: { ...NO_CHARACTER, interest: 100_000, longTermGain: 400_000, deductions: 50_000 },
      partners: [
        partner({ lpEntityId: 'lp-a', operatingIncome: 100_000, realizedGains: 400_000, expenses: 50_000 }),
      ],
    })
    expect(res.partners[0].tieOut.variance).toBe(0)
  })

  it('reports a variance rather than correcting it', () => {
    // The fund characterised only half its income. The K-1 says so; it does not invent the rest.
    const res = allocateK1({
      fund: { ...NO_CHARACTER, interest: 50_000 },
      partners: [partner({ lpEntityId: 'lp-a', operatingIncome: 100_000 })],
    })
    expect(res.partners[0].tieOut).toEqual({ computed: 50_000, fromCapital: 100_000, variance: -50_000 })
  })

  it('nets carried interest out of what a partner earned', () => {
    // Carry moves between partners; it is not income leaving the fund.
    const res = allocateK1({
      fund: { ...NO_CHARACTER, longTermGain: 1_000_000 },
      partners: [partner({ lpEntityId: 'lp-a', realizedGains: 1_000_000, carriedInterest: 200_000 })],
    })
    expect(res.partners[0].capitalAccount.netIncome).toBe(800_000)
    expect(res.partners[0].tieOut.variance).toBe(200_000)
  })
})

describe('capitalAccountFoots', () => {
  it('foots when the roll-forward is consistent', () => {
    const res = allocateK1({
      fund: { ...NO_CHARACTER, interest: 100_000 },
      partners: [
        partner({
          lpEntityId: 'lp-a',
          beginningCapital: 1_000_000,
          contributions: 500_000,
          distributions: 200_000,
          operatingIncome: 100_000,
          endingCapital: 1_400_000,
        }),
      ],
    })
    expect(capitalAccountFoots(res.partners[0]).variance).toBe(0)
  })

  it('reports a roll-forward that does not foot instead of forcing it', () => {
    const res = allocateK1({
      fund: NO_CHARACTER,
      partners: [
        partner({ lpEntityId: 'lp-a', beginningCapital: 1_000_000, endingCapital: 1_050_000 }),
      ],
    })
    expect(capitalAccountFoots(res.partners[0])).toEqual({
      expected: 1_000_000,
      actual: 1_050_000,
      variance: 50_000,
    })
  })
})

describe('box numbers', () => {
  it('maps every category to the box a preparer will look for', () => {
    expect(K1_BOX.interest).toBe('5')
    expect(K1_BOX.qualifiedDividends).toBe('6b')
    expect(K1_BOX.shortTermGain).toBe('8')
    expect(K1_BOX.longTermGain).toBe('9a')
    expect(K1_BOX.distributionsCash).toBe('19A')
  })
})
