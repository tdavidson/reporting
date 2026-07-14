import { describe, it, expect } from 'vitest'
import { planRow, isSkippedVehicle, type SnapshotRow } from './snapshot-cutover'

const ASOF = '2026-06-30'

const row = (p: Partial<SnapshotRow>): SnapshotRow => ({
  commitment: 0, paidInCapital: 0, calledCapital: null,
  distributions: 0, nav: 0, outstandingBalance: null, ...p,
})

// The whole cutover turns on this function. If it is wrong, every LP's capital account is
// wrong, and it is wrong SILENTLY — the numbers still add up, they're just not the LP's.
describe('planRow', () => {
  it('reconstructs the snapshot NAV exactly', () => {
    // Called 400k, distributed 100k, now worth 600k. Implied cumulative gain: 300k.
    const p = planRow(row({ commitment: 1_000_000, paidInCapital: 400_000, distributions: 100_000, nav: 600_000 }), ASOF)
    expect(p.endingCapital).toBe(600_000)
    expect(p.warnings).toEqual([])
  })

  it('keeps paid-in and distributions as their own events, so DPI/TVPI survive', () => {
    // The reason this is not a single opening_balance for NAV: that would leave paid-in and
    // distributions at zero, and every ratio computed from them would be wrong.
    const p = planRow(row({ commitment: 1_000_000, paidInCapital: 400_000, distributions: 100_000, nav: 600_000 }), ASOF)
    const by = Object.fromEntries(p.events.map(e => [e.sourceType, e.amount]))
    expect(by.capital_call).toBe(-400_000)   // debit-positive: a contribution is negative
    expect(by.distribution).toBe(100_000)    // ...and a distribution is positive
    expect(by.valuation).toBe(-300_000)      // the plug: nav - paid_in + distributions
  })

  it('books a LOSS as a positive (debit) valuation event', () => {
    // Called 500k, nothing distributed, now worth 300k.
    const p = planRow(row({ commitment: 500_000, paidInCapital: 500_000, distributions: 0, nav: 300_000 }), ASOF)
    const val = p.events.find(e => e.sourceType === 'valuation')!
    expect(val.amount).toBe(200_000)         // debit = reduces capital
    expect(p.endingCapital).toBe(300_000)
  })

  it('emits nothing for an LP with no activity', () => {
    expect(planRow(row({ commitment: 1_000_000 }), ASOF).events).toEqual([])
  })

  it('omits the plug when the snapshot shows no gain or loss', () => {
    const p = planRow(row({ commitment: 500_000, paidInCapital: 250_000, nav: 250_000 }), ASOF)
    expect(p.events.map(e => e.sourceType)).toEqual(['capital_call'])
    expect(p.endingCapital).toBe(250_000)
  })

  it('a fully-distributed LP ends at zero', () => {
    const p = planRow(row({ commitment: 100_000, paidInCapital: 100_000, distributions: 250_000, nav: 0 }), ASOF)
    expect(p.endingCapital).toBe(0)
    // Gain = 0 - 100k + 250k = 150k of profit.
    expect(p.events.find(e => e.sourceType === 'valuation')!.amount).toBe(-150_000)
  })

  it('rounds to cents and still ties', () => {
    const p = planRow(row({ commitment: 1_000_000, paidInCapital: 333_333.333, distributions: 11.115, nav: 500_000.005 }), ASOF)
    expect(p.endingCapital).toBe(500_000.01)
    expect(p.warnings).toEqual([])
  })
})

describe('planRow — cross-checks on the source data', () => {
  it('flags called != paid-in, and uses paid-in', () => {
    // In a snapshot these are the same figure. If they differ, the spreadsheet meant
    // something by it and we must not silently pick one.
    const p = planRow(row({ commitment: 1_000_000, paidInCapital: 400_000, calledCapital: 500_000, nav: 400_000 }), ASOF)
    expect(p.warnings.join()).toContain('differ')
    expect(p.events.find(e => e.sourceType === 'capital_call')!.amount).toBe(-400_000)
  })

  it("flags a snapshot whose own arithmetic doesn't tie", () => {
    // commitment - paid_in = 600k, but the snapshot claims 700k uncalled.
    const p = planRow(row({
      commitment: 1_000_000, paidInCapital: 400_000, nav: 400_000, outstandingBalance: 700_000,
    }), ASOF)
    expect(p.warnings.join()).toContain('uncalled')
  })

  it('accepts a snapshot that ties', () => {
    const p = planRow(row({
      commitment: 1_000_000, paidInCapital: 400_000, calledCapital: 400_000,
      nav: 400_000, outstandingBalance: 600_000,
    }), ASOF)
    expect(p.warnings).toEqual([])
  })

  it('flags paid-in above commitment', () => {
    const p = planRow(row({ commitment: 100_000, paidInCapital: 150_000, nav: 150_000 }), ASOF)
    expect(p.warnings.join()).toContain('exceeds commitment')
  })
})

describe('the skip list', () => {
  it('skips the vehicles already reconciled by hand, case-insensitively', () => {
    expect(isSkippedVehicle('Bluefish')).toBe(true)
    expect(isSkippedVehicle('  bluefish  ')).toBe(true)
    expect(isSkippedVehicle('Bluefish SPV Associates')).toBe(true)
  })

  it('does not skip anything else', () => {
    expect(isSkippedVehicle('Fund I')).toBe(false)
    // Not a prefix match — a differently-named Bluefish vehicle is NOT silently skipped.
    expect(isSkippedVehicle('Bluefish II')).toBe(false)
  })
})
