import { describe, it, expect } from 'vitest'
import { computeManagementFee } from './fees'
import { runWaterfall, type WaterfallState } from './waterfall'
import {
  buildCapitalCallEntry,
  buildManagementFeeEntry,
  buildExpenseEntry,
  buildGainEntry,
  buildRevaluationEntry,
  buildPeriodCloseEntry,
  buildDistributionEntry,
  buildCarryEntry,
  type CapitalAccountMap,
} from './entries'
import { isBalanced, accountBalances } from './ledger'
import { computeCapitalAccounts } from './capital-account'

const base = { fundId: 'f', entryDate: '2026-06-30' }
const capMap: CapitalAccountMap = new Map([['a', 'cap-a'], ['b', 'cap-b'], ['gp', 'cap-gp']])

describe('computeManagementFee', () => {
  it('charges rate × basis × period, pro-rated', () => {
    const res = computeManagementFee(
      { annualRate: 0.02, basis: 'committed', periodFraction: 0.25 },
      [
        { lpEntityId: 'a', basisAmount: 10_000_000 },
        { lpEntityId: 'b', basisAmount: 5_000_000 },
      ]
    )
    expect(res.lines[0].fee).toBe(50_000) // 10M × 2% × 0.25
    expect(res.lines[1].fee).toBe(25_000)
    expect(res.total).toBe(75_000)
  })

  it('honors side-letter overrides and exemptions', () => {
    const res = computeManagementFee(
      { annualRate: 0.02, basis: 'committed', periodFraction: 1 },
      [
        { lpEntityId: 'a', basisAmount: 1_000_000, rateOverride: 0.015 }, // side letter 1.5%
        { lpEntityId: 'b', basisAmount: 1_000_000, exempt: true },        // GP/employee vehicle
      ]
    )
    expect(res.lines[0].fee).toBe(15_000)
    expect(res.lines[1].fee).toBe(0)
    expect(res.total).toBe(15_000)
  })
})

describe('runWaterfall (European)', () => {
  const terms = { carryRate: 0.2 }
  const fresh: WaterfallState = {
    contributedCapital: 10_000_000,
    returnedCapital: 0,
    preferredPaid: 0,
    preferredTarget: 800_000, // 8% pref accrued
    gpCarryPaid: 0,
  }

  it('returns capital first, no carry until capital is back', () => {
    const res = runWaterfall(6_000_000, terms, fresh)
    expect(res.toReturnOfCapital).toBe(6_000_000)
    expect(res.toPreferred).toBe(0)
    expect(res.toGP).toBe(0)
    expect(res.toLP).toBe(6_000_000)
  })

  it('runs the full stack: capital, pref, GP catch-up, then 80/20 split', () => {
    // Distribute 12M against 10M capital + 0.8M pref. After ROC (10M) and pref (0.8M),
    // 1.2M remains. Catch-up: GP gets 100% until it holds 20% of (pref+catchup):
    // C = 0.2×0.8M/0.8 = 200k. Remaining 1.0M splits 80/20 → GP 200k, LP 800k.
    const res = runWaterfall(12_000_000, terms, fresh)
    expect(res.toReturnOfCapital).toBe(10_000_000)
    expect(res.toPreferred).toBe(800_000)
    expect(res.toCatchUp).toBe(200_000)
    expect(res.toCarryGP).toBe(200_000)
    expect(res.toCarryLP).toBe(800_000)
    expect(res.toGP).toBe(400_000)
    expect(res.toLP).toBe(11_600_000)
    // GP ends with 20% of total profit (0.8M pref + 1.2M upside = 2.0M profit → 400k = 20%).
    expect(res.toGP).toBe(0.2 * (800_000 + 1_200_000))
  })

  it('conserves cash: toLP + toGP equals the distribution', () => {
    const res = runWaterfall(12_000_000, terms, fresh)
    expect(res.toLP + res.toGP).toBe(12_000_000)
  })
})

describe('entry builders', () => {
  const owners = [{ lpEntityId: 'a', commitment: 6_000_000 }, { lpEntityId: 'b', commitment: 4_000_000 }]

  it('capital call is balanced and credits LP capital', () => {
    const e = buildCapitalCallEntry(base, 1_000_000, owners, capMap, 'cash')
    expect(isBalanced(e)).toBe(true)
    const caps = computeCapitalAccounts(
      e.postings.filter(p => p.lpEntityId).map(p => ({ lpEntityId: p.lpEntityId!, amount: p.amount, sourceType: e.sourceType }))
    )
    expect(caps.get('a')!.contributions).toBe(600_000)
    expect(caps.get('b')!.contributions).toBe(400_000)
  })

  const bridgeAccts = { pnlAccountId: 'mgmt-fee-exp', bridgeAccountId: 'bridge', offsetAccountId: 'due-to-gp' }

  it('management fee (compound) hits P&L and reduces LP capital by the computed fee', () => {
    const fee = computeManagementFee({ annualRate: 0.02, basis: 'committed', periodFraction: 1 },
      [{ lpEntityId: 'a', basisAmount: 6_000_000 }, { lpEntityId: 'b', basisAmount: 4_000_000 }])
    const e = buildManagementFeeEntry(base, fee, capMap, bridgeAccts)
    expect(isBalanced(e)).toBe(true)
    // P&L expense recorded (income statement correct).
    expect(accountBalances(e.postings).get('mgmt-fee-exp')).toBe(200_000)
    // Capital reduced per LP.
    const caps = computeCapitalAccounts(
      e.postings.filter(p => p.lpEntityId).map(p => ({ lpEntityId: p.lpEntityId!, amount: p.amount, sourceType: e.sourceType }))
    )
    expect(caps.get('a')!.managementFees).toBe(-120_000)
    expect(caps.get('b')!.managementFees).toBe(-80_000)
  })

  it('expense entry is balanced and pro-rata', () => {
    const e = buildExpenseEntry(base, 100_000, owners, capMap, { pnlAccountId: 'exp', bridgeAccountId: 'bridge', offsetAccountId: 'cash' })
    expect(isBalanced(e)).toBe(true)
    expect(accountBalances(e.postings).get('exp')).toBe(100_000)
  })

  it('gain entry increases LP capital and books income', () => {
    const e = buildGainEntry(base, 50_000, owners, capMap, { pnlAccountId: 'gains', bridgeAccountId: 'bridge', offsetAccountId: 'cash' })
    expect(isBalanced(e)).toBe(true)
    const caps = computeCapitalAccounts(
      e.postings.filter(p => p.lpEntityId).map(p => ({ lpEntityId: p.lpEntityId!, amount: p.amount, sourceType: e.sourceType }))
    )
    expect(caps.get('a')!.gains).toBe(30_000)
    expect(caps.get('b')!.gains).toBe(20_000)
  })

  it('revaluation allocates the mark per LP (up and down) and balances', () => {
    const up = buildRevaluationEntry(base, 100_000, owners, capMap, { unrealizedAssetId: 'unrl', incomeId: 'inc', bridgeId: 'bridge' })
    expect(isBalanced(up)).toBe(true)
    const capsUp = computeCapitalAccounts(up.postings.filter(p => p.lpEntityId).map(p => ({ lpEntityId: p.lpEntityId!, amount: p.amount, sourceType: up.sourceType })))
    expect(capsUp.get('a')!.gains).toBe(60_000)
    expect(capsUp.get('b')!.gains).toBe(40_000)

    const down = buildRevaluationEntry(base, -50_000, owners, capMap, { unrealizedAssetId: 'unrl', incomeId: 'inc', bridgeId: 'bridge' })
    expect(isBalanced(down)).toBe(true)
    const capsDown = computeCapitalAccounts(down.postings.filter(p => p.lpEntityId).map(p => ({ lpEntityId: p.lpEntityId!, amount: p.amount, sourceType: down.sourceType })))
    expect(capsDown.get('a')!.gains).toBe(-30_000)
  })

  it('period close zeroes P&L and nets the bridge to zero', () => {
    // Book a fee, then a gain, then close. Bridge should end at 0 and P&L flat.
    const fee = computeManagementFee({ annualRate: 0.02, basis: 'committed', periodFraction: 1 },
      [{ lpEntityId: 'a', basisAmount: 6_000_000 }, { lpEntityId: 'b', basisAmount: 4_000_000 }])
    const feeEntry = buildManagementFeeEntry(base, fee, capMap, bridgeAccts)
    const gainEntry = buildGainEntry(base, 50_000, owners, capMap, { pnlAccountId: 'gains', bridgeAccountId: 'bridge', offsetAccountId: 'cash' })
    const all = [...feeEntry.postings, ...gainEntry.postings]
    const bals = accountBalances(all)

    // P&L balances feed the close.
    const close = buildPeriodCloseEntry(base, [
      { accountId: 'mgmt-fee-exp', balance: bals.get('mgmt-fee-exp')! },
      { accountId: 'gains', balance: bals.get('gains')! },
    ], 'bridge')
    expect(isBalanced(close)).toBe(true)

    const afterClose = accountBalances([...all, ...close.postings])
    expect(afterClose.get('mgmt-fee-exp')).toBe(0)
    expect(afterClose.get('gains')).toBe(0)
    expect(afterClose.get('bridge') ?? 0).toBe(0) // bridge nets to zero
  })

  it('distribution and carry entries balance', () => {
    const dist = buildDistributionEntry(base, new Map([['a', 300_000], ['b', 200_000]]), capMap, 'cash')
    expect(isBalanced(dist)).toBe(true)
    const carry = buildCarryEntry(base, new Map([['a', 60_000], ['b', 40_000]]), capMap, 'cap-gp')
    expect(isBalanced(carry)).toBe(true)
  })
})
