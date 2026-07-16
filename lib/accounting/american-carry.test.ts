import { describe, it, expect } from 'vitest'
import { dealByDealCarry } from './american-carry'

const deal = (companyId: string, costBasis: number, proceeds: number, remainingValue = 0) =>
  ({ companyId, name: companyId, costBasis, proceeds, remainingValue })

describe('dealByDealCarry', () => {
  it('takes carry on each deal over its own cost, losers contribute nothing', () => {
    // A: cost 1M, exited for 3M → gain 2M → carry 400k. B: cost 1M, written off for 0 → no carry.
    const r = dealByDealCarry([deal('A', 1_000_000, 3_000_000), deal('B', 1_000_000, 0)], { carryRate: 0.2 })
    expect(r.deals[0].carry).toBe(400_000)
    expect(r.deals[1].carry).toBe(0)
    expect(r.totalCarry).toBe(400_000)
  })

  it('allocates fund expenses to each deal by cost share and carries only over the loaded cost', () => {
    // Two equal-cost deals, $200k total expenses → $100k each. A exits for 1.3M: gain over loaded
    // cost (1M + 100k) = 200k → carry 40k. B exits for 1.05M: gain over 1.1M is negative → 0.
    const r = dealByDealCarry(
      [deal('A', 1_000_000, 1_300_000), deal('B', 1_000_000, 1_050_000)],
      { carryRate: 0.2, totalExpenses: 200_000 },
    )
    expect(r.deals[0].allocatedExpense).toBe(100_000)
    expect(r.deals[0].fullyLoadedCost).toBe(1_100_000)
    expect(r.deals[0].carry).toBe(40_000)
    expect(r.deals[1].carry).toBe(0) // 1.05M < 1.1M loaded cost
    expect(r.totalCarry).toBe(40_000)
  })

  it('counts remaining fair value alongside realized proceeds (partially-realized deal)', () => {
    // Cost 1M, took 800k in proceeds and still holds 700k → total value 1.5M → gain 500k → carry 100k.
    const r = dealByDealCarry([deal('A', 1_000_000, 800_000, 700_000)], { carryRate: 0.2 })
    expect(r.deals[0].profit).toBe(500_000)
    expect(r.deals[0].carry).toBe(100_000)
  })

  it('is zero carry when the rate is zero', () => {
    const r = dealByDealCarry([deal('A', 1_000_000, 3_000_000)], { carryRate: 0 })
    expect(r.totalCarry).toBe(0)
  })
})
