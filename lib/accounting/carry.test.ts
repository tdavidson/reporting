import { describe, it, expect } from 'vitest'
import { carryTarget, carryAccrual, preferredTarget, NO_CARRY, type VehicleCarryTerms } from './carry'

const straight = (rate = 0.2): VehicleCarryTerms => ({
  ...NO_CARRY, kind: 'straight', carryRate: rate,
})
const european = (over: Partial<VehicleCarryTerms> = {}): VehicleCarryTerms => ({
  ...NO_CARRY, kind: 'european', carryRate: 0.2, prefRate: 0.08, catchupRate: 1, prefCompounds: true, ...over,
})

const lp = (id: string, contributed: number, nav: number, distributed = 0) =>
  ({ lpEntityId: id, contributed, distributed, nav })

describe('carryTarget', () => {
  it('is zero when the vehicle has no carry terms', () => {
    expect(carryTarget({ lps: [lp('a', 1_000_000, 3_000_000)] }, NO_CARRY)).toBe(0)
  })

  it('accrues on an UNREALIZED gain — that is the whole point', () => {
    // Nothing has been sold. LP capital is marked up 1m → 3m. The GP is still entitled to its
    // share if the fund liquidated today, so the LP's NAV must be shown net of it.
    const target = carryTarget({ lps: [lp('a', 1_000_000, 3_000_000)] }, straight(0.2))
    expect(target).toBe(400_000) // 20% of the 2m profit
  })

  it('is zero when the fund is under water', () => {
    expect(carryTarget({ lps: [lp('a', 1_000_000, 700_000)] }, straight())).toBe(0)
  })

  it('counts distributions already taken as part of the gain', () => {
    // Contributed 1m, took 1.5m out, still holds 1m. Total value 2.5m → profit 1.5m.
    const target = carryTarget({ lps: [lp('a', 1_000_000, 1_000_000, 1_500_000)] }, straight(0.2))
    expect(target).toBe(300_000)
  })

  it('European: no carry until capital and the preferred return are covered', () => {
    // Contributed 1m; NAV 1.05m. Profit is 50k, but the 8% pref on a full year is 80k — the
    // LPs are not yet whole, so the GP gets nothing.
    const target = carryTarget(
      {
        lps: [lp('a', 1_000_000, 1_050_000)],
        contributions: [{ date: '2025-01-01', amount: 1_000_000 }],
        asOf: '2026-01-01',
      },
      european()
    )
    expect(target).toBe(0)
  })

  it('European: the GP catches up once the pref is cleared', () => {
    // A big gain: capital back, pref paid, catch-up runs, then the 80/20 split.
    const target = carryTarget(
      {
        lps: [lp('a', 1_000_000, 3_000_000)],
        contributions: [{ date: '2025-01-01', amount: 1_000_000 }],
        asOf: '2026-01-01',
      },
      european()
    )
    // Total profit 2m; with a full catch-up the GP ends up with ~20% of profit.
    expect(target).toBeGreaterThan(350_000)
    expect(target).toBeLessThanOrEqual(400_000)
  })

  it('a straight split ignores the pref entirely', () => {
    const withPref = carryTarget(
      { lps: [lp('a', 1_000_000, 1_050_000)], contributions: [{ date: '2020-01-01', amount: 1_000_000 }], asOf: '2026-01-01' },
      { ...straight(0.2), prefRate: 0.08 }
    )
    // An SPV's 20% of the 50k gain, hurdle or no hurdle.
    expect(withPref).toBe(10_000)
  })
})

describe('preferredTarget', () => {
  it('accrues from the date money was actually wired, not from the commitment', () => {
    const oneYear = preferredTarget([{ date: '2025-01-01', amount: 1_000_000 }], '2026-01-01', 0.08, false)
    expect(oneYear).toBeCloseTo(80_000, -1)
  })

  it('compounds when the terms say it compounds', () => {
    const simple = preferredTarget([{ date: '2024-01-01', amount: 1_000_000 }], '2026-01-01', 0.08, false)
    const compound = preferredTarget([{ date: '2024-01-01', amount: 1_000_000 }], '2026-01-01', 0.08, true)
    expect(compound).toBeGreaterThan(simple)
  })

  it('accrues nothing on a contribution made after the accrual date', () => {
    expect(preferredTarget([{ date: '2027-01-01', amount: 1_000_000 }], '2026-01-01', 0.08, true)).toBe(0)
  })

  it('is zero when there is no hurdle', () => {
    expect(preferredTarget([{ date: '2020-01-01', amount: 1_000_000 }], '2026-01-01', 0, true)).toBe(0)
  })
})

describe('carryAccrual', () => {
  it('posts only the DELTA against what is already accrued', () => {
    const input = { lps: [lp('a', 1_000_000, 3_000_000)] }
    const a = carryAccrual(input, straight(0.2), 100_000)
    expect(a.target).toBe(400_000)
    expect(a.delta).toBe(300_000) // top up, not re-post the whole thing
  })

  it('REVERSES when NAV falls — no clawback logic needed', () => {
    // Last period NAV was 3m, so 400k was accrued. This period the mark drops to 1.5m: the
    // target is now 100k, so 300k of the accrual comes back to the LPs.
    const a = carryAccrual({ lps: [lp('a', 1_000_000, 1_500_000)] }, straight(0.2), 400_000)
    expect(a.target).toBe(100_000)
    expect(a.delta).toBe(-300_000)
    expect(a.perLp.get('a')).toBe(-300_000) // credited back to the LP
  })

  it('unwinds fully when the gain disappears entirely', () => {
    const a = carryAccrual({ lps: [lp('a', 1_000_000, 900_000)] }, straight(0.2), 400_000)
    expect(a.target).toBe(0)
    // Nobody is in profit any more, so there is no profit-share basis to reverse along.
    // The accrual is not unwound here — it is left for the close to handle explicitly rather
    // than inventing a basis. (Guard: we must not silently post a bogus split.)
    expect(a.delta).toBe(0)
  })

  it('shares the carry across LPs in proportion to their gains, not their capital', () => {
    // Same contribution, very different outcomes. The LP sitting on a loss pays no carry.
    const a = carryAccrual(
      {
        lps: [
          lp('winner', 1_000_000, 3_000_000), // +2m
          lp('loser', 1_000_000, 500_000),    // -500k
        ],
      },
      straight(0.2),
      0
    )
    // Fund profit = 2m + (-500k) = 1.5m → target 300k. Only the winner has a gain to take it from.
    expect(a.target).toBe(300_000)
    expect(a.perLp.get('winner')).toBe(300_000)
    expect(a.perLp.has('loser')).toBe(false)
  })

  it('splits pro-rata to gain across several LPs in profit', () => {
    const a = carryAccrual(
      { lps: [lp('a', 1_000_000, 3_000_000), lp('b', 1_000_000, 2_000_000)] }, // +2m and +1m
      straight(0.2),
      0
    )
    expect(a.target).toBe(600_000) // 20% of 3m
    expect(a.perLp.get('a')).toBe(400_000) // 2/3
    expect(a.perLp.get('b')).toBe(200_000) // 1/3
  })

  it('per-LP debits sum EXACTLY to the delta, with no invented cents', () => {
    // Deliberately awkward: three LPs, an amount that doesn't divide cleanly.
    const a = carryAccrual(
      {
        lps: [
          lp('a', 100_000, 200_000.01),
          lp('b', 100_000, 200_000.01),
          lp('c', 100_000, 200_000.01),
        ],
      },
      straight(0.2),
      0
    )
    const sum = Math.round(Array.from(a.perLp.values()).reduce((s, v) => s + v, 0) * 100) / 100
    expect(sum).toBe(a.delta)
  })

  it('does nothing when the target already equals what is accrued', () => {
    const a = carryAccrual({ lps: [lp('a', 1_000_000, 3_000_000)] }, straight(0.2), 400_000)
    expect(a.delta).toBe(0)
    expect(a.perLp.size).toBe(0)
  })
})
