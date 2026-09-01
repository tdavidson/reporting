import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ASSUMPTIONS, parseAssumptions, projectRemainingFees, constructionModel, blankStage,
  type ConstructionAssumptions, type ConstructionActuals,
} from './construction'

const A = (over: Partial<ConstructionAssumptions> = {}): ConstructionAssumptions => ({
  ...DEFAULT_ASSUMPTIONS,
  feeAnnualRate: 0.02,
  feeBasis: 'committed',
  feeTermYears: 10,
  feeStartDate: '2020-01-01',
  ...over,
})

// Elapsed time is measured in 365.25-day years, so a "5 year" gap is 5.002 of them and the fee
// lands ~760 off a hand-calculated round number. These assert the magnitude to within $5,000
// rather than pretending the calendar is tidy. The EXACT waterfall is pinned in the capital
// tests below, which use a fee term that has already run out.
describe('projectRemainingFees', () => {
  it('charges the remaining years at the flat rate', () => {
    // 10-year term from 2020-01-01; ~5 years remain at 2025-01-01. ≈ 5 × 2% × 18.5M.
    expect(projectRemainingFees(A(), 18_500_000, 0, 0, new Date('2025-01-01'))).toBeCloseTo(1_850_000, -4)
  })

  it('honours the step-down', () => {
    // Years 6-10 at 1.5% instead of 2%: ≈ 5 × 1.5% × 18.5M.
    const stepped = projectRemainingFees(
      A({ feeStepDownYear: 6, feeStepDownRate: 0.015 }), 18_500_000, 0, 0, new Date('2025-01-01'),
    )
    expect(stepped).toBeCloseTo(1_387_500, -4)
    // And it is genuinely lower than the flat-rate projection, not merely near a constant.
    expect(stepped).toBeLessThan(projectRemainingFees(A(), 18_500_000, 0, 0, new Date('2025-01-01')))
  })

  it('applies the step-down only from its year, not to the whole remaining term', () => {
    // Standing at year 2, years 2-7 are at 2% and 8-10 at 1.5%: strictly between a flat 2%
    // projection and a flat 1.5% one.
    const at2 = new Date('2022-01-01')
    const stepped = projectRemainingFees(A({ feeStepDownYear: 8, feeStepDownRate: 0.015 }), 18_500_000, 0, 0, at2)
    expect(stepped).toBeLessThan(projectRemainingFees(A(), 18_500_000, 0, 0, at2))
    expect(stepped).toBeGreaterThan(projectRemainingFees(A({ feeAnnualRate: 0.015 }), 18_500_000, 0, 0, at2))
  })

  it('is zero once the term has run', () => {
    expect(projectRemainingFees(A(), 18_500_000, 0, 0, new Date('2031-01-01'))).toBe(0)
  })

  it('is zero when there is no fee clock to start from', () => {
    expect(projectRemainingFees(A({ feeStartDate: '' }), 18_500_000, 0, 0, new Date('2025-01-01'))).toBe(0)
  })

  it('charges a partial remaining year', () => {
    // ~9.5 years elapsed at 2029-07-01, so ~0.5 remain: ≈ 0.5 × 2% × 18.5M.
    expect(projectRemainingFees(A(), 18_500_000, 0, 0, new Date('2029-07-01'))).toBeCloseTo(185_000, -4)
  })

  it('bases on invested capital when the basis says so', () => {
    // ≈ 5 remaining years × 2% × 8M deployed.
    expect(projectRemainingFees(A({ feeBasis: 'invested' }), 18_500_000, 8_000_000, 0, new Date('2025-01-01')))
      .toBeCloseTo(800_000, -4)
  })
})

describe('parseAssumptions', () => {
  // NO STRATEGY DEFAULTS. An unplanned vehicle states nothing about its own strategy — no stage
  // mix, no portfolio target, no target multiple, no fee terms. The first version shipped one
  // firm's parameters here, which read as neutral and would have been silently wrong for anyone
  // else. The fee CLOCK is still derived from the recorded vintage: that is the fund's own data,
  // not an assumption about it.
  it('states nothing about strategy for an absent row, but derives the fee clock from vintage', () => {
    const a = parseAssumptions(null, 2020)
    expect(a.feeStartDate).toBe('2020-01-01')
    expect(a.stages).toEqual([])
    expect(a.targetPortfolioSize).toBe(0)
    expect(a.targetFundMultiple).toBe(0)
    expect(a.feeAnnualRate).toBe(0)
    expect(a.feeTermYears).toBe(0)
    // The one survivor: the axis of a what-if table, not a claim about this fund.
    expect(a.sensitivityOwnerships).toEqual([0.01, 0.02, 0.03])
  })

  it('leaves the fee clock empty when there is no vintage either', () => {
    // Better than guessing a start date: projectRemainingFees then projects nothing, and the
    // GP is asked for the date rather than shown a number derived from a fiction.
    expect(parseAssumptions(null, null).feeStartDate).toBe('')
  })

  it('drops a malformed stage rather than producing NaN downstream', () => {
    const a = parseAssumptions({
      stages: [
        { key: 'seed', label: 'Seed', deals: 10, initialCheck: 500_000, initialPostMoney: 11_000_000, followOnMultiple: 1, dilutionFactor: 0.3 },
        { key: 'junk' },
      ],
    }, 2020)
    expect(a.stages).toHaveLength(1)
    expect(a.stages[0].key).toBe('seed')
  })

  it('keeps an incomplete stage through autosave without dividing by zero', () => {
    const a = parseAssumptions({
      stages: [{ key: 'x', label: 'X', deals: 1, initialCheck: 500_000, initialPostMoney: 0, followOnMultiple: 1, dilutionFactor: 0.3 }],
    }, 2020)
    expect(a.stages).toHaveLength(1)
    expect(constructionModel(ACT(), A({ stages: a.stages }), NOW).returns.stages[0].initialOwnership).toBe(0)
  })

  it('rejects a fee basis outside the CHECK constraint', () => {
    expect(parseAssumptions({ feeBasis: 'moon' }, 2020).feeBasis).toBe('committed')
  })
})

// Fund III, as the workbook states it. The fee term is deliberately RUN OUT (start 2010,
// 10-year term, "today" 2025) so feesProjected is exactly 0 and the whole lifetime fee arrives
// as an incurred actual. The waterfall is then exact, and independent of the 365.25-day year
// arithmetic that projectRemainingFees is separately pinned on above. Coupling the two would
// make a waterfall test fail for a fee-projection reason.
const NOW = new Date('2025-01-01')
const RUN_OUT = { feeStartDate: '2010-01-01', feeTermYears: 10 } as const

const ACT = (over: Partial<ConstructionActuals> = {}): ConstructionActuals => ({
  committedCapital: 18_500_000,
  managementFeesIncurred: 3_745_945,     // workbook B53
  orgCostsIncurred: 49_241,              // workbook B51
  partnershipExpensesIncurred: 668_154,  // workbook B52
  ledgerAvailable: true,
  deployedInitial: 8_000_000,
  deployedFollowOn: 1_500_000,
  companyCount: 18,
  currentValue: 11_000_000,
  nav: 11_000_000,
  ...over,
})

describe('constructionModel — capital', () => {
  it('walks committed down to investable', () => {
    const m = constructionModel(ACT(), A(RUN_OUT), NOW)
    expect(m.capital.feesProjected).toBe(0)
    expect(m.capital.lifetimeFees).toBeCloseTo(3_745_945, 2)
    expect(m.capital.lifetimeExpenses).toBeCloseTo(717_395, 2)
    expect(m.capital.investable).toBeCloseTo(14_036_660, 2)  // workbook B54
  })

  it('adds projected fees to incurred ones when the term is still running', () => {
    const running = constructionModel(ACT({ managementFeesIncurred: 1_895_945 }), A(), NOW)
    expect(running.capital.feesProjected).toBeGreaterThan(0)
    expect(running.capital.lifetimeFees).toBeCloseTo(1_895_945 + running.capital.feesProjected, 2)
    // More lifetime fees means less investable capital. That direction is the whole point.
    expect(running.capital.investable).toBeLessThan(18_500_000 - 1_895_945 - 717_395)
  })

  it('remaining is investable less deployed less the reserve pool', () => {
    const m = constructionModel(ACT(), A({ ...RUN_OUT, existingReservePool: 1_500_000 }), NOW)
    // 14,036,660 − 9,500,000 − 1,500,000
    expect(m.capital.remaining).toBeCloseTo(3_036_660, 2)
    expect(m.capital.deployedTotal).toBe(9_500_000)
  })

  it('counts the deals still to do against the target portfolio size', () => {
    const m = constructionModel(ACT(), A({ ...RUN_OUT, targetPortfolioSize: 20 }), NOW)
    expect(m.capital.plannedNewDeals).toBe(2)
    expect(m.capital.avgPerRemainingDeal).toBeCloseTo(4_536_660 / 2, 2)
  })

  it('costs the stage mix and reports the gap', () => {
    // 2 seed deals × 500k × (1 + 1.0 follow-on) = 2M planned against 3,036,660 remaining.
    const stages = [{ key: 'seed', label: 'Seed', deals: 2, initialCheck: 500_000, initialPostMoney: 11_000_000, followOnMultiple: 1, dilutionFactor: 0.3 }]
    const m = constructionModel(ACT(), A({ ...RUN_OUT, stages, existingReservePool: 1_500_000, targetPortfolioSize: 20 }), NOW)
    expect(m.capital.plannedCost).toBe(2_000_000)
    expect(m.capital.gap).toBeCloseTo(1_036_660, 2)
    expect(m.warnings).toEqual([])
  })

  it('warns when the mix costs more than remains', () => {
    const stages = [{ key: 'seed', label: 'Seed', deals: 2, initialCheck: 2_000_000, initialPostMoney: 11_000_000, followOnMultiple: 1, dilutionFactor: 0.3 }]
    const m = constructionModel(ACT(), A({ ...RUN_OUT, stages, targetPortfolioSize: 20 }), NOW)
    expect(m.capital.gap).toBeLessThan(0)
    expect(m.warnings.some(w => w.includes('more capital than remains'))).toBe(true)
  })

  it('warns when the stage deal counts do not add up to the deals still to do', () => {
    const stages = [{ key: 'seed', label: 'Seed', deals: 7, initialCheck: 100_000, initialPostMoney: 11_000_000, followOnMultiple: 0, dilutionFactor: 0.3 }]
    const m = constructionModel(ACT(), A({ ...RUN_OUT, stages, targetPortfolioSize: 20 }), NOW)
    expect(m.warnings.some(w => w.includes('7 deals') && w.includes('2'))).toBe(true)
  })

  it('does not derive 0 fees from an absent ledger', () => {
    const m = constructionModel(
      ACT({ ledgerAvailable: false, managementFeesIncurred: 0, orgCostsIncurred: 0, partnershipExpensesIncurred: 0 }),
      A(RUN_OUT), NOW,
    )
    expect(m.capital.ledgerAvailable).toBe(false)
    expect(m.warnings.some(w => w.includes('not on the ledger'))).toBe(true)
  })
})

describe('constructionModel — returns', () => {
  const MIX = [
    { key: 'pre_seed', label: 'Pre-seed', deals: 5, initialCheck: 500_000, initialPostMoney: 7_000_000, followOnMultiple: 1, dilutionFactor: 0.3 },
    { key: 'seed', label: 'Seed', deals: 10, initialCheck: 500_000, initialPostMoney: 11_000_000, followOnMultiple: 1, dilutionFactor: 0.3 },
    { key: 'post_seed', label: 'Post-seed', deals: 5, initialCheck: 250_000, initialPostMoney: 20_000_000, followOnMultiple: 1, dilutionFactor: 0.4 },
  ]

  it('derives initial and exit ownership per stage', () => {
    const m = constructionModel(ACT(), A({ ...RUN_OUT, stages: MIX }), NOW)
    const preSeed = m.returns.stages.find(s => s.key === 'pre_seed')!
    expect(preSeed.initialOwnership).toBeCloseTo(0.0714286, 6)   // 500k / 7M
    expect(preSeed.ownershipAtExit).toBeCloseTo(0.0214286, 6)    // × 0.3
    expect(preSeed.exitToReturnFund).toBeCloseTo(863_333_333, -3) // 18.5M / 0.0214286
    expect(preSeed.allocation).toBe(5_000_000)                    // 5 × 500k × 2
  })

  it('weights ownership at exit by deal count', () => {
    const m = constructionModel(ACT(), A({ ...RUN_OUT, stages: MIX }), NOW)
    // (0.0214286×5 + 0.0136364×10 + 0.005×5) / 20
    expect(m.returns.wAvgOwnershipAtExit).toBeCloseTo(0.0134253, 6)
  })

  it('computes the required portfolio value and the average exit that reaches it', () => {
    const m = constructionModel(ACT(), A({ ...RUN_OUT, stages: MIX, targetFundMultiple: 5, targetPortfolioSize: 20 }), NOW)
    expect(m.returns.requiredPortfolioValue).toBe(92_500_000)      // workbook B61
    expect(m.returns.avgExitForTargetReturn).toBeCloseTo(344_498_000, -4)  // workbook F63
  })

  it('states the multiple on invested alongside the multiple on committed', () => {
    const m = constructionModel(ACT(), A({ ...RUN_OUT, stages: MIX, targetFundMultiple: 5 }), NOW)
    // 92.5M / 14,036,660 investable — the number the portfolio actually has to clear.
    expect(m.returns.impliedMultipleOnInvested).toBeCloseTo(6.59, 2)
  })

  it('bands the sensitivity across the given ownerships plus the weighted average', () => {
    const m = constructionModel(ACT(), A({ ...RUN_OUT, stages: MIX, targetFundMultiple: 5, targetPortfolioSize: 20, sensitivityOwnerships: [0.01, 0.02, 0.03] }), NOW)
    expect(m.returns.sensitivity).toHaveLength(4)   // three stated + the weighted average
    expect(m.returns.sensitivity[3].isWeightedAverage).toBe(true)
    const onePct = m.returns.sensitivity[0]
    expect(onePct.ownershipAtExit).toBe(0.01)
    expect(onePct.avgExitForTargetReturn).toBeCloseTo(462_500_000, 0)  // workbook B63
    expect(onePct.exitToReturnFund).toBeCloseTo(1_850_000_000, 0)      // workbook B64
  })

  it('is null rather than Infinity when the mix has no deals', () => {
    const m = constructionModel(ACT(), A({ ...RUN_OUT, stages: [] }), NOW)
    expect(m.returns.wAvgOwnershipAtExit).toBeNull()
    expect(m.returns.avgExitForTargetReturn).toBeNull()
    expect(m.returns.exitToReturnFund).toBeNull()
    expect(m.returns.sensitivity.every(row => !row.isWeightedAverage)).toBe(true)
  })
})

describe('inline portfolio forecast', () => {
  const position = {
    companyId: 'company-1', name: 'Known Co', stage: 'Seed', status: 'active',
    investedInitial: 500_000, investedFollowOn: 100_000, investedTotal: 600_000,
    currentValue: 900_000, currentMoic: 1.5, currentOwnership: 0.03,
    currentPostMoney: 30_000_000, distributions: 0,
  }

  it('rolls company follow-ons and remaining deals into new/follow-on capital', () => {
    const m = constructionModel(ACT({ positions: [position] }), A({
      ...RUN_OUT,
      positionForecasts: [{ companyId: 'company-1', plannedFollowOn: 200_000, ownershipAtExit: 0.02, expectedExitValue: 100_000_000 }],
      stages: [{
        key: 'seed', label: 'Seed', deals: 2, initialCheck: 500_000,
        initialPostMoney: 10_000_000, followOnMultiple: 0, followOnCheck: 250_000,
        dilutionFactor: 0, ownershipAtExit: 0.02, expectedExitValue: 50_000_000,
      }],
    }), NOW)

    expect(m.capital.plannedExistingFollowOn).toBe(200_000)
    expect(m.capital.plannedNewCapital).toBe(1_000_000)
    expect(m.capital.plannedNewFollowOn).toBe(500_000)
    expect(m.capital.plannedCost).toBe(1_700_000)
    expect(m.capital.projectedNew).toBe(9_000_000)
    expect(m.capital.projectedFollowOn).toBe(2_200_000)
  })

  it('updates company, remaining-portfolio, and total return metrics from inline inputs', () => {
    const m = constructionModel(ACT({ positions: [position], currentValue: 900_000 }), A({
      ...RUN_OUT,
      positionForecasts: [{ companyId: 'company-1', plannedFollowOn: 200_000, ownershipAtExit: 0.02, expectedExitValue: 100_000_000 }],
      stages: [{
        key: 'seed', label: 'Seed', deals: 2, initialCheck: 500_000,
        initialPostMoney: 10_000_000, followOnMultiple: 0, followOnCheck: 250_000,
        dilutionFactor: 0, ownershipAtExit: 0.02, expectedExitValue: 50_000_000,
      }],
    }), NOW)

    expect(m.returns.positions[0].estimatedReturn).toBe(2_000_000)
    expect(m.returns.positions[0].estimatedMoic).toBe(2.5)
    expect(m.returns.estimatedExistingValue).toBe(2_000_000)
    expect(m.returns.estimatedFutureValue).toBe(2_000_000)
    expect(m.returns.estimatedPortfolioValue).toBe(4_000_000)
  })

  it('keeps direct inline dollar and ownership inputs through validation', () => {
    const parsed = parseAssumptions({
      positionForecasts: [{ companyId: 'company-1', plannedFollowOn: 200_000, ownershipAtExit: 0.02, expectedExitValue: 100_000_000 }],
      stages: [{
        key: 'seed', label: 'Seed', deals: 2, initialCheck: 500_000,
        initialPostMoney: 10_000_000, followOnMultiple: 0, followOnCheck: 250_000,
        dilutionFactor: 0, ownershipAtExit: 0.02, expectedExitValue: 50_000_000,
      }],
    }, null)
    expect(parsed.positionForecasts[0].plannedFollowOn).toBe(200_000)
    expect(parsed.stages[0].followOnCheck).toBe(250_000)
    expect(parsed.stages[0].ownershipAtExit).toBe(0.02)
    expect(parsed.stages[0].expectedExitValue).toBe(50_000_000)
  })
})

// The model this replaces, end to end. If these drift, the page and the GP's spreadsheet
// disagree about the same fund — the failure that matters most.
describe('Fund III, against the source workbook', () => {
  it('reproduces the investable-capital and return figures', () => {
    const m = constructionModel(
      ACT(),
      A({
        ...RUN_OUT,
        stages: [
          { key: 'pre_seed', label: 'Pre-seed', deals: 5, initialCheck: 500_000, initialPostMoney: 7_000_000, followOnMultiple: 1, dilutionFactor: 0.3 },
          { key: 'seed', label: 'Seed', deals: 10, initialCheck: 500_000, initialPostMoney: 11_000_000, followOnMultiple: 1, dilutionFactor: 0.3 },
          { key: 'post_seed', label: 'Post-seed', deals: 5, initialCheck: 250_000, initialPostMoney: 20_000_000, followOnMultiple: 1, dilutionFactor: 0.4 },
        ],
        targetFundMultiple: 5,
        targetPortfolioSize: 20,
      }),
      NOW,
    )
    expect(m.capital.investable).toBeCloseTo(14_036_660, 2)         // workbook B54
    expect(m.returns.requiredPortfolioValue).toBe(92_500_000)        // workbook B61
    expect(m.returns.wAvgOwnershipAtExit).toBeCloseTo(0.0134, 4)     // workbook G71 / F62
    expect(m.returns.exitToReturnFund).toBeCloseTo(1_377_992_745, -4) // workbook F64
    expect(m.returns.sensitivity[0].exitToReturnFund).toBeCloseTo(1_850_000_000, 0) // workbook B64
  })
})

// An unconfigured vehicle must read as unanswered, not as a fund in trouble. Shouting at someone
// who has not filled the form in yet trains them to ignore the warnings that matter.
describe('an unplanned vehicle', () => {
  const BLANK = () => constructionModel(ACT(), parseAssumptions(null, null), NOW)

  it('reports no deal count rather than a negative one', () => {
    // targetPortfolioSize 0 − 18 companies would be −18, which is not a fact about anything.
    expect(BLANK().capital.plannedNewDeals).toBeNull()
    expect(BLANK().capital.avgPerRemainingDeal).toBeNull()
  })

  it('reports no gap rather than claiming the whole fund is unspent', () => {
    expect(BLANK().capital.gap).toBeNull()
  })

  it('reports no required portfolio value rather than zero', () => {
    const m = BLANK()
    expect(m.returns.requiredPortfolioValue).toBeNull()
    expect(m.returns.impliedMultipleOnInvested).toBeNull()
    expect(m.returns.avgExitForTargetReturn).toBeNull()
    expect(m.returns.sensitivity.every(row => row.avgExitForTargetReturn === null)).toBe(true)
  })

  it('raises no stage-mix warnings at all', () => {
    expect(BLANK().warnings).toEqual([])
  })

  it('still reports what IS known — capital committed, deployed and investable', () => {
    const m = BLANK()
    expect(m.capital.committedCapital).toBe(18_500_000)
    expect(m.capital.deployedTotal).toBe(9_500_000)
    expect(m.capital.companyCount).toBe(18)
    // No fee terms stated, so nothing is projected — only what the ledger actually incurred.
    expect(m.capital.feesProjected).toBe(0)
    expect(m.capital.investable).toBeCloseTo(14_036_660, 2)
  })
})

describe('blankStage', () => {
  it('is empty apart from its label and survives autosave before it is priced', () => {
    const s = blankStage('Seed')
    expect(s.label).toBe('Seed')
    expect(s.deals).toBe(0)
    expect(s.initialCheck).toBe(0)
    expect(parseAssumptions({ stages: [s] }, null).stages).toHaveLength(1)
    expect(parseAssumptions({ stages: [{ ...s, initialPostMoney: 10_000_000 }] }, null).stages).toHaveLength(1)
  })

  it('gives each row a distinct key, so React keys and edits do not collide', () => {
    expect(blankStage().key).not.toBe(blankStage().key)
  })
})
