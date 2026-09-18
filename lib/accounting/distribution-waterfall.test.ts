import { describe, it, expect } from 'vitest'
import { NO_CARRY, type VehicleCarryTerms } from './carry'
import { replayWaterfallState, splitDistribution, suggestedCharacter } from './distribution-waterfall'

const GP = 'gp'
const straight = (rate = 0.2): VehicleCarryTerms => ({
  ...NO_CARRY, kind: 'straight', carryRate: rate, gpEntityId: GP, recipients: [{ lpEntityId: GP, pct: 100 }],
})
const european = (over: Partial<VehicleCarryTerms> = {}): VehicleCarryTerms => ({
  ...NO_CARRY, kind: 'european', carryRate: 0.2, prefRate: 0.08, catchupRate: 1, prefCompounds: false,
  gpEntityId: GP, recipients: [{ lpEntityId: GP, pct: 100 }], ...over,
})

const partner = (lpEntityId: string, contributed: number, ending: number, distributed = 0) =>
  ({ lpEntityId, contributed, ending, distributed })

const sum = (lines: { amount: number }[]) => Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100

describe('splitDistribution', () => {
  it('with no carry terms, falls back to pro-rata by capital balance across every partner', () => {
    const split = splitDistribution({
      total: 1000,
      terms: NO_CARRY,
      partners: [partner('a', 500, 750), partner('b', 500, 250), partner(GP, 0, 100)],
      contributions: [],
      priors: [],
      asOf: '2026-06-30',
    })
    expect(split.method).toBe('pro_rata')
    expect(split.carryLines).toEqual([])
    // 750 : 250 : 100 of 1000
    expect(split.lines).toEqual([
      { lpEntityId: 'a', amount: 681.82 },
      { lpEntityId: 'b', amount: 227.27 },
      { lpEntityId: GP, amount: 90.91 },
    ])
    expect(sum(split.lines)).toBe(1000)
  })

  it('straight 20%: the first distribution returns capital before any carry', () => {
    // LPs put in 1m. The fund distributes 800k — all of it is capital coming back.
    const split = splitDistribution({
      total: 800_000,
      terms: straight(0.2),
      partners: [partner('a', 600_000, 900_000), partner('b', 400_000, 600_000), partner(GP, 0, 0)],
      contributions: [{ date: '2025-01-01', amount: 600_000 }, { date: '2025-01-01', amount: 400_000 }],
      priors: [],
      asOf: '2026-01-01',
    })
    expect(split.method).toBe('waterfall')
    expect(split.tiers.returnOfCapital).toBe(800_000)
    expect(split.tiers.toGP).toBe(0)
    expect(split.carryLines).toEqual([])
    // By CONTRIBUTED capital, not by balance: 60/40.
    expect(split.lines).toEqual([
      { lpEntityId: 'a', amount: 480_000 },
      { lpEntityId: 'b', amount: 320_000 },
    ])
  })

  it('straight 20%: once capital is back, profit splits 80/20 and the GP gets a carry line', () => {
    const split = splitDistribution({
      total: 500_000,
      terms: straight(0.2),
      partners: [partner('a', 600_000, 900_000, 600_000), partner('b', 400_000, 600_000, 400_000), partner(GP, 0, 0)],
      contributions: [{ date: '2025-01-01', amount: 600_000 }, { date: '2025-01-01', amount: 400_000 }],
      // A prior distribution returned all 1m of capital.
      priors: [{ date: '2025-12-01', amount: 1_000_000 }],
      asOf: '2026-01-01',
    })
    expect(split.stateBefore.returnedCapital).toBe(1_000_000)
    expect(split.tiers.returnOfCapital).toBe(0)
    expect(split.tiers.carry).toBe(100_000)
    expect(split.tiers.profitToLP).toBe(400_000)
    expect(split.carryLines).toEqual([{ lpEntityId: GP, amount: 100_000 }])
    expect(split.lines).toEqual([
      { lpEntityId: 'a', amount: 240_000 },
      { lpEntityId: 'b', amount: 160_000 },
    ])
    expect(sum(split.lines) + sum(split.carryLines)).toBe(500_000)
  })

  it('a distribution straddling the return-of-capital line splits the excess at the carry rate', () => {
    const split = splitDistribution({
      total: 1_200_000,
      terms: straight(0.2),
      partners: [partner('a', 1_000_000, 1_500_000), partner(GP, 0, 0)],
      contributions: [{ date: '2025-01-01', amount: 1_000_000 }],
      priors: [],
      asOf: '2026-01-01',
    })
    expect(split.tiers.returnOfCapital).toBe(1_000_000)
    expect(split.tiers.carry).toBe(40_000)
    expect(split.tiers.profitToLP).toBe(160_000)
    expect(split.lines).toEqual([{ lpEntityId: 'a', amount: 1_160_000 }])
    expect(split.carryLines).toEqual([{ lpEntityId: GP, amount: 40_000 }])
  })

  it('European: the preferred return is paid to LPs before the GP catches up', () => {
    // 1m contributed a year ago at 8% simple → 80k pref. Distribute 1.2m:
    //   1,000,000 return of capital, 80,000 pref, then the GP catches up 20% of (pref + catch-up):
    //   C = 0.2 × 80k / 0.8 = 20k, leaving 100k split 80/20.
    const split = splitDistribution({
      total: 1_200_000,
      terms: european(),
      partners: [partner('a', 1_000_000, 1_400_000), partner(GP, 0, 0)],
      contributions: [{ date: '2025-01-01', amount: 1_000_000 }],
      priors: [],
      asOf: '2026-01-01',
    })
    expect(split.tiers.returnOfCapital).toBe(1_000_000)
    expect(split.tiers.preferred).toBe(80_000)
    expect(split.tiers.catchUp).toBe(20_000)
    expect(split.tiers.carry).toBe(20_000)
    expect(split.tiers.profitToLP).toBe(80_000)
    expect(split.tiers.toLP).toBe(1_160_000)
    expect(split.tiers.toGP).toBe(40_000)
    expect(sum(split.lines) + sum(split.carryLines)).toBe(1_200_000)
  })

  it('carry splits across several recipients by percentage and ties to the cent', () => {
    const terms = straight(0.2)
    terms.recipients = [{ lpEntityId: 'gp1', pct: 66.67 }, { lpEntityId: 'gp2', pct: 33.33 }]
    const split = splitDistribution({
      total: 100.01,
      terms,
      partners: [partner('a', 0, 0, 1000), partner('gp1', 0, 0), partner('gp2', 0, 0)],
      contributions: [{ date: '2025-01-01', amount: 1000 }],
      priors: [{ date: '2025-06-01', amount: 1000 }],
      asOf: '2026-01-01',
    })
    expect(split.tiers.carry).toBe(20)
    expect(sum(split.carryLines)).toBe(20)
    expect(split.carryLines.map(l => l.lpEntityId)).toEqual(['gp1', 'gp2'])
  })

  it('excludes the carry recipient from the LP tiers and warns when it has contributed capital', () => {
    const split = splitDistribution({
      total: 100,
      terms: straight(0.2),
      partners: [partner('a', 990, 990), partner(GP, 10, 10)],
      contributions: [{ date: '2025-01-01', amount: 990 }],
      priors: [],
      asOf: '2026-01-01',
    })
    expect(split.lines).toEqual([{ lpEntityId: 'a', amount: 100 }])
    expect(split.warnings.some(w => w.includes(GP))).toBe(true)
  })

  it('warns when the books disagree with the replayed carry', () => {
    const split = splitDistribution({
      total: 100,
      terms: straight(0.2),
      partners: [partner('a', 1000, 1500, 1500), partner(GP, 0, 0)],
      contributions: [{ date: '2025-01-01', amount: 1000 }],
      priors: [{ date: '2025-06-01', amount: 1500 }], // implies 100 of carry paid
      asOf: '2026-01-01',
      carryPaidToDate: 0, // but the GP was never paid — the old pro-rata split
    })
    expect(split.stateBefore.gpCarryPaid).toBe(100)
    expect(split.warnings.some(w => w.includes('split differently'))).toBe(true)
  })

  it('carry terms with no recipient degrade to pro-rata with a warning', () => {
    const split = splitDistribution({
      total: 100,
      terms: { ...straight(0.2), recipients: [], gpEntityId: null },
      partners: [partner('a', 100, 100)],
      contributions: [],
      priors: [],
      asOf: '2026-01-01',
    })
    expect(split.method).toBe('pro_rata')
    expect(split.warnings.length).toBe(1)
  })
})

describe('replayWaterfallState', () => {
  it('accrues the hurdle to each prior distribution date, not to today', () => {
    // 1m contributed 2025-01-01 at 8% simple. 182 days in the hurdle stands at 39,890.41
    // (1m × 8% × 182/365). A distribution of exactly capital plus that much pays the hurdle to
    // that date and leaves nothing for a catch-up. By 2026-01-01 the hurdle is 80k, of which
    // 39,890.41 is paid.
    const state = replayWaterfallState(
      [{ date: '2025-07-02', amount: 1_039_890.41 }],
      [{ date: '2025-01-01', amount: 1_000_000 }],
      european(),
      '2026-01-01',
    )
    expect(state.returnedCapital).toBe(1_000_000)
    expect(state.preferredPaid).toBe(39_890.41)
    expect(state.preferredTarget).toBe(80_000)
    expect(state.gpCarryPaid).toBe(0)
  })

  it('ignores priors dated after the replay date and contributions not yet made', () => {
    const state = replayWaterfallState(
      [{ date: '2026-06-01', amount: 500 }],
      [{ date: '2025-01-01', amount: 1000 }, { date: '2026-06-01', amount: 1000 }],
      straight(),
      '2026-01-01',
    )
    expect(state.returnedCapital).toBe(0)
    expect(state.contributedCapital).toBe(1000)
  })
})

describe('suggestedCharacter', () => {
  it('reads return of capital off the tier and calls the rest gain', () => {
    expect(suggestedCharacter({ returnOfCapital: 300, preferred: 50, catchUp: 10, carry: 20, profitToLP: 80, toLP: 430, toGP: 30 }, 460))
      .toEqual({ returnOfCapital: 300, realizedGain: 160, income: 0 })
  })
})
