import { describe, it, expect } from 'vitest'
import { constructionModel, DEFAULT_ASSUMPTIONS, type ConstructionActuals, type ConstructionAssumptions } from './construction'
import { forecastSchedule, dealTimelines, irrOf, DEFAULT_PACING, type PacingAssumptions, type ForecastBaseline } from './construction-forecast'

const actuals = (over: Partial<ConstructionActuals> = {}): ConstructionActuals => ({
  committedCapital: 10_000_000,
  calledCapital: 3_000_000,
  uncalledCapital: 7_000_000,
  managementFeesIncurred: 400_000,
  orgCostsIncurred: 50_000,
  partnershipExpensesIncurred: 50_000,
  ledgerAvailable: true,
  deployedInitial: 2_000_000,
  deployedFollowOn: 0,
  companyCount: 2,
  currentValue: 3_000_000,
  nav: 3_100_000,
  positions: [
    { companyId: 'c1', name: 'Alpha', stage: 'Seed', status: 'active', investedInitial: 1_000_000, investedFollowOn: 0, investedTotal: 1_000_000, currentValue: 2_000_000, currentMoic: 2, currentOwnership: 0.1, currentPostMoney: 20_000_000, distributions: 0 },
    { companyId: 'c2', name: 'Beta', stage: 'Seed', status: 'active', investedInitial: 1_000_000, investedFollowOn: 0, investedTotal: 1_000_000, currentValue: 1_000_000, currentMoic: 1, currentOwnership: 0.1, currentPostMoney: 10_000_000, distributions: 0 },
  ],
  ...over,
})

const assumptions = (over: Partial<ConstructionAssumptions> = {}): ConstructionAssumptions => ({
  ...DEFAULT_ASSUMPTIONS,
  feeAnnualRate: 0.02,
  feeTermYears: 5,
  annualPartnershipExpense: 20_000,
  positionForecasts: [
    { companyId: 'c1', plannedFollowOn: 500_000, ownershipAtExit: 0.1, expectedExitValue: 50_000_000, returnMethod: 'ownership' }, // 5m
    { companyId: 'c2', plannedFollowOn: 0, ownershipAtExit: 0, forecastMoic: 0, expectedExitValue: 0, returnMethod: 'moic' }, // defaults to the fund-wide 3x
  ],
  stages: [
    { key: 's1', label: 'Deal A', initialCheck: 1_000_000, initialPostMoney: 10_000_000, followOnMultiple: 0, followOnCheck: 500_000, dilutionFactor: 0.5, forecastMoic: 3, returnMethod: 'moic' }, // 4.5m
    { key: 's2', label: 'Deal B', initialCheck: 1_000_000, initialPostMoney: 10_000_000, followOnMultiple: 0, followOnCheck: 0, dilutionFactor: 0.5, forecastMoic: 0, returnMethod: 'moic' }, // fund-wide 3x = 3m
  ],
  ...over,
})

const pacing = (over: Partial<PacingAssumptions> = {}): PacingAssumptions => ({
  ...DEFAULT_PACING, deploymentYears: 2, followOnLagYears: 1, holdYears: 5, existingHoldYears: 4, horizonYears: 0, accretion: 'none', ...over,
})

const baseline: ForecastBaseline = { asOf: '2026-09-18', calledCapital: 3_000_000, distributed: 0, nav: 3_100_000 }

describe('dealTimelines', () => {
  it('spreads planned deals over the deployment period and holds them for the stated years', () => {
    const model = constructionModel(actuals(), assumptions())
    const deals = dealTimelines(model, pacing())
    const planned = deals.filter(d => d.kind === 'planned')
    expect(planned.map(d => d.initialAt)).toEqual([0.5, 1.5])
    expect(planned.map(d => d.exitAt)).toEqual([5.5, 6.5])
    expect(planned[0].followOnAt).toBe(1.5)
    const existing = deals.filter(d => d.kind === 'existing')
    expect(existing.every(d => d.exitAt === 4)).toBe(true)
    expect(existing[0].followOnAt).toBe(1)
  })

  it('writes every remaining check now with a zero deployment period', () => {
    const model = constructionModel(actuals(), assumptions())
    const planned = dealTimelines(model, pacing({ deploymentYears: 0 })).filter(d => d.kind === 'planned')
    expect(planned.every(d => d.initialAt === 0)).toBe(true)
  })

  it('anchors each existing deal to its known investment date and uses the hold period', () => {
    const positions = actuals().positions!.map((position, index) => ({
      ...position,
      firstInvestmentDate: index === 0 ? '2022-09-18' : '2024-09-18',
    }))
    const model = constructionModel(actuals({ positions }), assumptions())
    const existing = dealTimelines(model, pacing({ holdYears: 6, existingHoldYears: 6 }), baseline.asOf)
      .filter(d => d.kind === 'existing')
    expect(existing[0].initialAt).toBeCloseTo(-4, 2)
    expect(existing[0].exitAt).toBeCloseTo(2, 2)
    expect(existing[1].initialAt).toBeCloseTo(-2, 2)
    expect(existing[1].exitAt).toBeCloseTo(4, 2)
  })
})

describe('forecastSchedule', () => {
  it('runs to the last exit, calls capital as it is needed, and returns proceeds in the exit year', () => {
    const model = constructionModel(actuals(), assumptions())
    const s = forecastSchedule(model, assumptions(), pacing(), baseline)
    expect(s.stated).toBe(true)
    expect(s.horizonYears).toBe(7)
    expect(s.years).toHaveLength(8)
    // Year 1: Deal A's check (0.5y) and both existing follow-ons (1y); fees 2% × 10m; expenses 20k.
    const y1 = s.years[1]
    expect(y1.invested).toBe(1_500_000)
    expect(y1.fees).toBe(200_000)
    expect(y1.expenses).toBe(20_000)
    expect(y1.called).toBe(1_720_000 - 100_000) // baseline cash of 100k (nav 3.1m over 3.0m carrying) is spent first
    // Year 4: the existing book exits — Alpha 5m, Beta at the fund-wide 3x default.
    expect(s.years[4].distributed).toBe(8_000_000)
    // Year 6: Deal A exits at 3× its 1.5m; year 7: Deal B at the 3x default.
    expect(s.years[6].distributed).toBe(4_500_000)
    expect(s.years[7].distributed).toBe(3_000_000)
    expect(s.years[7].nav).toBe(0)
    expect(s.years[7].dpi).toBeCloseTo(15_500_000 / s.years[7].cumCalled, 6)
    expect(s.years[7].tvpi).toBe(s.years[7].dpi)
    expect(s.years[7].netIrr).toBeGreaterThan(0)
    expect(s.warnings).toEqual([])
  })

  it('stops charging fees after the fee term and expenses with it', () => {
    const model = constructionModel(actuals(), assumptions())
    const s = forecastSchedule(model, assumptions(), pacing(), baseline)
    expect(s.years[5].fees).toBe(200_000)
    expect(s.years[6].fees).toBe(0)
    expect(s.years[6].expenses).toBe(0)
  })

  it('warns when the plan calls more than the commitments can cover', () => {
    const model = constructionModel(actuals({ committedCapital: 4_000_000, uncalledCapital: 1_000_000 }), assumptions())
    const s = forecastSchedule(model, assumptions(), pacing(), baseline)
    expect(s.shortfall).toBeGreaterThan(0)
    expect(s.warnings.some(w => w.includes('more than the fund can still call'))).toBe(true)
  })

  it('a horizon shorter than the last exit leaves deals in NAV and says so', () => {
    const model = constructionModel(actuals(), assumptions())
    const s = forecastSchedule(model, assumptions(), pacing({ horizonYears: 5 }), baseline)
    expect(s.years).toHaveLength(6)
    expect(s.years[5].nav).toBeGreaterThan(0)
    expect(s.warnings.some(w => w.includes('after the 5-year horizon'))).toBe(true)
  })

  it('linear accretion marks NAV toward the forecast between now and the exit', () => {
    const model = constructionModel(actuals(), assumptions())
    const flat = forecastSchedule(model, assumptions(), pacing({ accretion: 'none' }), baseline)
    const accreting = forecastSchedule(model, assumptions(), pacing({ accretion: 'linear' }), baseline)
    expect(accreting.years[2].nav).toBeGreaterThan(flat.years[2].nav)
    // Both agree once everything has exited.
    expect(accreting.years[7].tvpi).toBe(flat.years[7].tvpi)
    expect(accreting.years[7].cumDistributed).toBe(flat.years[7].cumDistributed)
  })

  it('an override replaces a deal’s proceeds and exit year and nothing else', () => {
    const model = constructionModel(actuals(), assumptions())
    const s = forecastSchedule(model, assumptions(), pacing(), baseline, new Map([['s1', { proceeds: 0, exitAt: 3 }]]))
    expect(s.years[6].distributed).toBe(0)
    expect(s.years[3].distributed).toBe(0) // a write-off returns nothing
    expect(s.years[1].invested).toBe(1_500_000) // the check is still written
  })

  it('can still represent a deliberately unstated pacing plan', () => {
    const model = constructionModel(actuals(), assumptions())
    const empty = { ...DEFAULT_PACING, deploymentYears: 0, followOnLagYears: 0, holdYears: 0, existingHoldYears: 0 }
    expect(forecastSchedule(model, assumptions(), empty, baseline).stated).toBe(false)
  })
})

describe('irrOf', () => {
  it('finds the rate that doubles money in five years', () => {
    expect(irrOf([{ t: 0, amount: -100 }, { t: 5, amount: 200 }])).toBeCloseTo(Math.pow(2, 1 / 5) - 1, 6)
  })
  it('is null without a sign change or a time spread', () => {
    expect(irrOf([{ t: 0, amount: -100 }, { t: 1, amount: -50 }])).toBeNull()
    expect(irrOf([{ t: 0, amount: -100 }, { t: 0, amount: 100 }])).toBeNull()
  })
  it('uses the dated history when the baseline carries it', () => {
    const model = constructionModel(actuals(), assumptions())
    const dated = forecastSchedule(model, assumptions(), pacing(), { ...baseline, historyFlows: [{ t: -3, amount: -3_000_000 }] })
    const lump = forecastSchedule(model, assumptions(), pacing(), baseline)
    // Money called three years ago earns the same multiple over a longer time: a lower IRR.
    expect(dated.years[7].netIrr!).toBeLessThan(lump.years[7].netIrr!)
  })
})

describe('per-deal timing', () => {
  it('a company’s own exit year and follow-on timing win over the fund-wide pacing', () => {
    const model = constructionModel(actuals(), assumptions({
      positionForecasts: [
        { companyId: 'c1', plannedFollowOn: 500_000, ownershipAtExit: 0.1, expectedExitValue: 50_000_000, returnMethod: 'ownership', exitInYears: 2, followOnInYears: 0.5 },
        { companyId: 'c2', plannedFollowOn: 0, ownershipAtExit: 0, forecastMoic: 0, expectedExitValue: 0, returnMethod: 'moic' },
      ],
    }))
    const deals = dealTimelines(model, pacing())
    const alpha = deals.find(d => d.key === 'c1')!
    const beta = deals.find(d => d.key === 'c2')!
    expect(alpha).toMatchObject({ exitAt: 2, followOnAt: 0.5, timing: 'stated' })
    expect(beta).toMatchObject({ exitAt: 4, timing: 'pacing' })
    const s = forecastSchedule(model, assumptions(), pacing(), baseline)
    expect(s.years[2].distributed).toBe(5_000_000)
    expect(s.years[4].distributed).toBe(3_000_000)
  })

  it('a planned deal’s own investment year and hold win over the spread', () => {
    const model = constructionModel(actuals(), assumptions({
      stages: [
        { key: 's1', label: 'Deal A', initialCheck: 1_000_000, initialPostMoney: 10_000_000, followOnMultiple: 0, followOnCheck: 500_000, dilutionFactor: 0.5, forecastMoic: 3, returnMethod: 'moic', investInYears: 3, exitInYears: 2, followOnInYears: 1 },
      ],
    }))
    const [deal] = dealTimelines(model, pacing()).filter(d => d.kind === 'planned')
    expect(deal).toMatchObject({ initialAt: 3, followOnAt: 4, exitAt: 5, timing: 'stated' })
  })

  it('a stated per-deal exit makes the schedule stated even with no fund-wide pacing', () => {
    const model = constructionModel(actuals(), assumptions({
      positionForecasts: [{ companyId: 'c1', plannedFollowOn: 0, ownershipAtExit: 0.1, expectedExitValue: 50_000_000, returnMethod: 'ownership', exitInYears: 3 }],
    }))
    expect(forecastSchedule(model, assumptions(), DEFAULT_PACING, baseline).stated).toBe(true)
  })

  it('carries per-deal simulation overrides onto the timeline', () => {
    const model = constructionModel(actuals(), assumptions({
      positionForecasts: [{ companyId: 'c1', plannedFollowOn: 0, ownershipAtExit: 0.1, expectedExitValue: 50_000_000, returnMethod: 'ownership', simLossRate: 0.1, simDispersion: 0.5, simExitSpreadYears: 1 }],
    }))
    const alpha = dealTimelines(model, pacing()).find(d => d.key === 'c1')!
    expect(alpha).toMatchObject({ lossRate: 0.1, dispersion: 0.5, exitSpreadYears: 1 })
    const beta = dealTimelines(model, pacing()).find(d => d.key === 'c2')!
    expect(beta.lossRate).toBeUndefined()
  })
})
