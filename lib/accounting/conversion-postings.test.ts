import { describe, it, expect } from 'vitest'
import { conversionPostings } from './from-portfolio'

const ACC = {
  costId: '1100', cashId: '1000', unrealizedId: '1200',
  accruedInterestId: '1150', unrealizedIncomeId: '4200',
}
const sum = (ps: { amount: number }[]) => Math.round(ps.reduce((s, p) => s + p.amount, 0) * 100) / 100
const at = (ps: { accountId: string; amount: number }[], id: string) =>
  ps.filter(p => p.accountId === id).reduce((s, p) => s + p.amount, 0)

describe('conversionPostings', () => {
  it('pure SAFE conversion: only a step-up, no cash leg, balances', () => {
    // $100k SAFE → 50,000 @ $3.00 = $150k. Principal already in 1100, so only the +$50k step-up posts.
    const ps = conversionPostings({ carriedPrincipal: 100_000, interest: 0, newCash: 0, shares: 50_000, price: 3 }, ACC)
    expect(sum(ps)).toBe(0)
    expect(at(ps, '1000')).toBe(0)              // no cash moved — a pure conversion
    expect(at(ps, '1100')).toBe(0)              // principal not re-posted
    expect(at(ps, '1200')).toBe(50_000)         // step-up into unrealized
    expect(at(ps, '4200')).toBe(-50_000)        // recognized as change in unrealized appreciation
  })

  it('note conversion with interest + new cash capitalizes basis and moves cash', () => {
    // $100k note + $4k accrued interest + $25k new check → 50,000 @ $3.00 = $150k.
    const ps = conversionPostings({ carriedPrincipal: 100_000, interest: 4_000, newCash: 25_000, shares: 50_000, price: 3 }, ACC)
    expect(sum(ps)).toBe(0)
    expect(at(ps, '1100')).toBe(29_000)         // interest + new cash added to basis
    expect(at(ps, '1150')).toBe(-4_000)         // accrued interest retired into basis
    expect(at(ps, '1000')).toBe(-25_000)        // only the new check is cash
    expect(at(ps, '1200')).toBe(21_000)         // step-up = 150k - (100k+4k+25k)
    expect(at(ps, '4200')).toBe(-21_000)
  })

  it('down-round conversion books an unrealized loss', () => {
    const ps = conversionPostings({ carriedPrincipal: 100_000, interest: 0, newCash: 0, shares: 10_000, price: 5 }, ACC)
    expect(sum(ps)).toBe(0)
    expect(at(ps, '1200')).toBe(-50_000)        // 50k value < 100k basis
    expect(at(ps, '4200')).toBe(50_000)
  })

  it('holds at carried cost when no round price is given (no step-up)', () => {
    const ps = conversionPostings({ carriedPrincipal: 100_000, interest: 0, newCash: 0, shares: 0, price: 0 }, ACC)
    expect(ps).toHaveLength(0)                   // nothing to book: no cash, no interest, no value change
  })

  it('omits the interest leg when the chart has no accrued-interest account', () => {
    const ps = conversionPostings({ carriedPrincipal: 0, interest: 4_000, newCash: 0, shares: 0, price: 0 },
      { costId: '1100', cashId: '1000', unrealizedId: '1200', unrealizedIncomeId: '4200' })
    // Without 1150 we can't retire the receivable; the caller refuses this case rather than
    // posting an unbalanced entry. The pure fn just drops the credit leg → unbalanced by design,
    // which is why the route guards on accruedInterestId before calling.
    expect(at(ps, '1150')).toBe(0)
  })
})
