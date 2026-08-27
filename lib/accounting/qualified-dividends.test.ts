import { describe, it, expect } from 'vitest'
import {
  REQUIRED_DAYS,
  classifyDividend,
  daysHeldInWindow,
  isDomesticPayer,
  summarizeQualifiedDividends,
  type DividendFact,
} from './qualified-dividends'

function dividend(over: Partial<DividendFact> = {}): DividendFact {
  return {
    id: 'txn-1',
    companyId: 'co-1',
    date: '2026-09-30',
    amount: 100_000,
    payerCountry: 'US',
    holdingType: 'company',
    lots: [{ acquired: '2022-01-01', units: 1_000 }],
    ...over,
  }
}

describe('isDomesticPayer', () => {
  it('accepts the ways a US country code actually gets written', () => {
    expect(isDomesticPayer('US')).toBe(true)
    expect(isDomesticPayer('usa')).toBe(true)
    expect(isDomesticPayer(' United States ')).toBe(true)
  })

  it('is false for anywhere else, and for nothing', () => {
    expect(isDomesticPayer('CA')).toBe(false)
    expect(isDomesticPayer(null)).toBe(false)
  })
})

describe('daysHeldInWindow', () => {
  it('gives a long-held, still-held lot the whole 121-day window', () => {
    // The ordinary case. An earlier version stopped counting at the dividend date, capping every
    // lot at 60 and making the >60 test unsatisfiable — cautious-looking and simply broken.
    expect(daysHeldInWindow('2022-01-01', '2026-09-30')).toBe(121)
  })

  it('starts counting the day AFTER acquisition, per §1223', () => {
    // Bought the day the window opens: 60 of the window's first 61 days, not 61.
    expect(daysHeldInWindow('2026-08-01', '2026-09-30', '2026-09-30')).toBe(60)
  })

  it('stops counting on the day the lot is sold', () => {
    expect(daysHeldInWindow('2022-01-01', '2026-09-30', '2026-10-10')).toBe(71)
  })

  it('ignores a sale after the window closes', () => {
    expect(daysHeldInWindow('2022-01-01', '2026-09-30', '2027-06-01')).toBe(121)
  })

  it('is nothing for stock acquired after the window closes', () => {
    expect(daysHeldInWindow('2027-01-15', '2026-09-30')).toBe(0)
  })
})

describe('classifyDividend', () => {
  it('qualifies a dividend from a long-held US company', () => {
    // The ordinary case, and the one an earlier pass wrongly refused to compute: a private US
    // C corp has no market, and needs none — tradability is a test for FOREIGN payers only.
    const v = classifyDividend(dividend())
    expect(v.verdict).toBe('qualified')
    expect(v.reason).toContain('Domestic payer')
  })

  it('will not qualify a dividend from a fund holding', () => {
    // A partnership distributes its distributive share. That is not a dividend at all.
    const v = classifyDividend(dividend({ holdingType: 'fund' }))
    expect(v.verdict).toBe('not_qualified')
    expect(v.reason).toContain('distributive share')
  })

  it('will not qualify crypto income', () => {
    expect(classifyDividend(dividend({ holdingType: 'crypto' })).verdict).toBe('not_qualified')
  })

  it('asks for the country rather than assuming one', () => {
    const v = classifyDividend(dividend({ payerCountry: null }))
    expect(v.verdict).toBe('uncertain')
    expect(v.reason).toContain('country')
  })

  it('sends a foreign payer for a decision instead of guessing either way', () => {
    const v = classifyDividend(dividend({ payerCountry: 'DE' }))
    expect(v.verdict).toBe('uncertain')
    expect(v.reason).toContain('treaty-eligible')
  })

  it('is uncertain when the stock was bought late and sold straight after', () => {
    // The dividend-stripping shape the rule exists to catch: in shortly before, out shortly after.
    const v = classifyDividend(
      dividend({ lots: [{ acquired: '2026-09-20', units: 100, disposed: '2026-10-05' }] }),
    )
    expect(v.verdict).toBe('uncertain')
    expect(v.reason).toContain('needs more than 60')
  })

  it('qualifies stock bought close to the dividend but held well past it', () => {
    // Only 10 days before, but 60 after — 70 in the window, which passes.
    const v = classifyDividend(dividend({ lots: [{ acquired: '2026-09-20', units: 100 }] }))
    expect(v.verdict).toBe('qualified')
  })

  it('takes the longest-held lot, since one qualifying lot is enough for its own dividend', () => {
    const v = classifyDividend(
      dividend({
        lots: [
          { acquired: '2026-09-20', units: 10 },
          { acquired: '2020-01-01', units: 990 },
        ],
      }),
    )
    expect(v.verdict).toBe('qualified')
  })

  it('needs MORE than 60 days, not 60 exactly', () => {
    const sold = { acquired: '2026-08-01', units: 1, disposed: '2026-09-30' }
    expect(daysHeldInWindow(sold.acquired, '2026-09-30', sold.disposed)).toBe(REQUIRED_DAYS)
    expect(classifyDividend(dividend({ lots: [sold] })).verdict).toBe('uncertain')
  })

  it('cannot test a dividend with no lots behind it', () => {
    const v = classifyDividend(dividend({ lots: [] }))
    expect(v.verdict).toBe('uncertain')
    expect(v.reason).toContain('No lots')
  })
})

describe('summarizeQualifiedDividends', () => {
  it('keeps the three verdicts apart so nothing is quietly rolled into 6b', () => {
    const s = summarizeQualifiedDividends([
      dividend({ id: 'a', amount: 100_000 }),
      dividend({ id: 'b', amount: 40_000, holdingType: 'fund' }),
      dividend({ id: 'c', amount: 25_000, payerCountry: null }),
    ])
    expect(s.qualified).toBe(100_000)
    expect(s.notQualified).toBe(40_000)
    expect(s.uncertain).toBe(25_000)
  })

  it('returns a verdict per dividend, so a reviewer can see which and why', () => {
    const s = summarizeQualifiedDividends([dividend({ id: 'a' }), dividend({ id: 'b', payerCountry: 'FR' })])
    expect(s.verdicts.map(v => v.id)).toEqual(['a', 'b'])
    expect(s.verdicts[1].reason).toContain('FR')
  })

  it('is empty for a year with no dividends', () => {
    expect(summarizeQualifiedDividends([])).toMatchObject({ qualified: 0, notQualified: 0, uncertain: 0 })
  })
})
