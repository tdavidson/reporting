import { describe, expect, it } from 'vitest'
import { buildPresentationBlocks, constructionSummaryBlock } from './response'

const constructionResult = {
  vehicle: 'Fund II',
  vehicleId: 'vehicle-2',
  vintageYear: 2024,
  ledgerAvailable: true,
  asOf: '2026-09-02T12:00:00.000Z',
  actuals: {},
  assumptions: {
    feeAnnualRate: 0.02,
    feeBasis: 'committed',
    feeTermYears: 7,
    annualPartnershipExpense: 25_000,
    remainingOrgCosts: 10_000,
  },
  forecast: {
    capital: {
      committedCapital: 10_000_000,
      calledCapital: 4_000_000,
      uncalledCapital: 6_000_000,
      investable: 8_000_000,
      deployedTotal: 3_000_000,
      remaining: 5_000_000,
      plannedExistingFollowOn: 500_000,
      plannedNewCapital: 1_000_000,
      plannedNewFollowOn: 1_000_000,
      gap: 2_500_000,
    },
  },
  positions: [{
    actual: {
      companyId: 'company-1',
      name: 'Example Co',
      status: 'active',
      investedTotal: 1_000_000,
    },
    currentValue: 1_500_000,
    estimatedReturn: 4_000_000,
    returnMethod: 'ownership',
  }],
  warnings: ['Review the reserve plan.'],
}

describe('Analyst presentation blocks', () => {
  it('deterministically maps a canonical construction result', () => {
    expect(constructionSummaryBlock(constructionResult)).toEqual({
      version: 1,
      type: 'constructionSummary',
      data: {
        vehicle: 'Fund II',
        vintageYear: 2024,
        ledgerAvailable: true,
        asOf: '2026-09-02T12:00:00.000Z',
        capital: expect.objectContaining({ remaining: 5_000_000, gap: 2_500_000 }),
        assumptions: {
          feeAnnualRate: 0.02,
          feeBasis: 'committed',
          feeTermYears: 7,
          annualPartnershipExpense: 25_000,
          remainingOrgCosts: 10_000,
        },
        positions: [{
          companyId: 'company-1',
          name: 'Example Co',
          status: 'active',
          investedTotal: 1_000_000,
          currentValue: 1_500_000,
          estimatedReturn: 4_000_000,
          returnMethod: 'ownership',
        }],
        warnings: ['Review the reserve plan.'],
      },
    })
  })

  it('ignores malformed tool results and emits pending actions from trusted previews', () => {
    expect(buildPresentationBlocks([
      { name: 'portfolio_construction', input: {}, result: { vehicle: 'incomplete' } },
    ], [{
      id: 'action-1',
      actionType: 'update_portfolio_construction',
      preview: { summary: 'Update Fund II', details: { changes: 1 } },
    }])).toEqual([{
      version: 1,
      type: 'pendingAction',
      action: {
        id: 'action-1',
        actionType: 'update_portfolio_construction',
        summary: 'Update Fund II',
        details: { changes: 1 },
      },
    }])
  })
})
