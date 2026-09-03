import { describe, it, expect } from 'vitest'
import {
  DIFFERENCE_IS_PERMANENT,
  ORG_AMORTIZATION_MONTHS,
  netAdjustment,
  orgAmortizationForYear,
  orgImmediateDeduction,
  proposeAdjustments,
  type ActualBookYear,
} from './book-tax'

const NO_ORG: ActualBookYear['org'] = { monthsInYear: 0, monthsAlreadyAmortized: 0, isFirstYear: false }

function year(over: Partial<ActualBookYear> = {}): ActualBookYear {
  return {
    unrealizedChange: 0,
    carryAccruedOnUnrealized: 0,
    organizationalExpense: 0,
    organizationalCostsToDate: 0,
    syndicationExpense: 0,
    org: NO_ORG,
    ...over,
  }
}

describe('§709 organizational costs', () => {
  describe('orgImmediateDeduction', () => {
    it('gives the full $5,000 below the phase-out threshold', () => {
      expect(orgImmediateDeduction(20_000)).toBe(5_000)
      expect(orgImmediateDeduction(50_000)).toBe(5_000)
    })

    it('phases out dollar-for-dollar above $50,000', () => {
      expect(orgImmediateDeduction(52_000)).toBe(3_000)
      expect(orgImmediateDeduction(54_999)).toBe(1)
    })

    it('vanishes entirely at $55,000 — the case a fund actually hits', () => {
      expect(orgImmediateDeduction(55_000)).toBe(0)
      expect(orgImmediateDeduction(200_000)).toBe(0)
    })

    it('never exceeds the costs themselves', () => {
      expect(orgImmediateDeduction(1_200)).toBe(1_200)
    })

    it('is zero for no costs', () => {
      expect(orgImmediateDeduction(0)).toBe(0)
      expect(orgImmediateDeduction(-100)).toBe(0)
    })
  })

  describe('orgAmortizationForYear', () => {
    it('deducts the immediate amount plus a partial first year', () => {
      // $60,000 of org costs, fund begins business in October: no immediate deduction (phased
      // out above $55,000), three months of amortization.
      const r = orgAmortizationForYear({
        totalOrgCosts: 60_000,
        monthsInYear: 3,
        isFirstYear: true,
        bookExpense: 60_000,
      })
      expect(r.immediate).toBe(0)
      expect(r.amortization).toBe(roundTo(60_000 / ORG_AMORTIZATION_MONTHS * 3))
      expect(r.deductible).toBe(r.amortization)
      // Book expensed the lot; tax got a thousand. The rest is a timing difference.
      expect(r.adjustment).toBe(roundTo(60_000 - r.amortization))
    })

    it('takes the immediate deduction only in the first year', () => {
      const first = orgAmortizationForYear({ totalOrgCosts: 20_000, monthsInYear: 12, isFirstYear: true, bookExpense: 0 })
      const later = orgAmortizationForYear({ totalOrgCosts: 20_000, monthsInYear: 12, isFirstYear: false, bookExpense: 0 })
      expect(first.immediate).toBe(5_000)
      expect(later.immediate).toBe(0)
      // The amortizable base is net of the immediate deduction, so the later year is larger.
      expect(later.amortization).toBeGreaterThan(first.amortization)
    })

    it('cannot amortize past 180 months', () => {
      const r = orgAmortizationForYear({
        totalOrgCosts: 180_000,
        monthsInYear: 12,
        monthsAlreadyAmortized: 175,
        isFirstYear: false,
        bookExpense: 0,
      })
      expect(r.months).toBe(5)
    })

    it('is fully amortized once 180 months have run', () => {
      const r = orgAmortizationForYear({
        totalOrgCosts: 180_000,
        monthsInYear: 12,
        monthsAlreadyAmortized: 180,
        isFirstYear: false,
        bookExpense: 0,
      })
      expect(r.months).toBe(0)
      expect(r.amortization).toBe(0)
    })

    it('reports a negative adjustment in a year book expensed nothing', () => {
      // Book expensed everything at inception; in year two tax still deducts amortization, so
      // taxable income is now LOWER than book. The sign has to survive that.
      const r = orgAmortizationForYear({
        totalOrgCosts: 180_000,
        monthsInYear: 12,
        monthsAlreadyAmortized: 12,
        isFirstYear: false,
        bookExpense: 0,
      })
      expect(r.adjustment).toBeLessThan(0)
    })
  })
})

describe('proposeAdjustments', () => {
  it('proposes nothing when there is nothing to adjust', () => {
    expect(proposeAdjustments(year())).toEqual([])
  })

  it('reverses unrealized appreciation', () => {
    const [p] = proposeAdjustments(year({ unrealizedChange: 2_500_000 }))
    expect(p.kind).toBe('unrealized')
    expect(p.amount).toBe(2_500_000)
    expect(p.permanent).toBe(false)
  })

  it('reverses unrealized depreciation with the opposite sign', () => {
    const [p] = proposeAdjustments(year({ unrealizedChange: -800_000 }))
    expect(p.amount).toBe(-800_000)
  })

  it('treats carry accrued on unrealized gains as its own difference', () => {
    // Not folded into the unrealized adjustment: carry is an equity reallocation between
    // partners, so it moves capital without touching income.
    const props = proposeAdjustments(year({ unrealizedChange: 1_000_000, carryAccruedOnUnrealized: 200_000 }))
    expect(props.map(p => p.kind)).toEqual(['unrealized', 'carry_on_unrealized'])
  })

  it('marks syndication costs permanent and organizational costs not', () => {
    const props = proposeAdjustments(
      year({
        syndicationExpense: 150_000,
        organizationalExpense: 60_000,
        organizationalCostsToDate: 60_000,
        org: { monthsInYear: 12, monthsAlreadyAmortized: 0, isFirstYear: true },
      }),
    )
    const byKind = Object.fromEntries(props.map(p => [p.kind, p]))
    expect(byKind.syndication.permanent).toBe(true)
    expect(byKind.organizational_709.permanent).toBe(false)
    expect(DIFFERENCE_IS_PERMANENT.syndication).toBe(true)
  })

  it('explains the §709 arithmetic in the rationale', () => {
    const [p] = proposeAdjustments(
      year({
        organizationalExpense: 20_000,
        organizationalCostsToDate: 20_000,
        org: { monthsInYear: 12, monthsAlreadyAmortized: 0, isFirstYear: true },
      }),
    )
    expect(p.rationale).toContain('5000.00 immediate')
    expect(p.rationale).toContain('180 months')
  })

  it('drops zero-amount differences so a proposal list is a to-do list', () => {
    const props = proposeAdjustments(
      year({
        unrealizedChange: 0,
        syndicationExpense: 500,
        organizationalExpense: 0,
        organizationalCostsToDate: 0,
        org: NO_ORG,
      }),
    )
    expect(props).toHaveLength(1)
    expect(props[0].kind).toBe('syndication')
  })

  it('nets to the book-over-tax income difference', () => {
    const props = proposeAdjustments(
      year({ unrealizedChange: 1_000_000, carryAccruedOnUnrealized: -200_000, syndicationExpense: 50_000 }),
    )
    expect(netAdjustment(props)).toBe(850_000)
  })
})

function roundTo(n: number): number {
  return Math.round(n * 100) / 100
}
