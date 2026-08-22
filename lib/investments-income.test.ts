import { describe, it, expect } from 'vitest'
import { computeSummary } from './investments'
import { buildSoiPositions, type SoiCompany } from '@/lib/accounting/soi'
import type { InvestmentTransaction } from '@/lib/types/database'

// The double-count this feature exists to prevent:
//
// An airdrop recorded as a VALUATION UPDATE adds value but no basis. The unrealized line picks
// up income that is not appreciation, and when the units are sold the whole proceeds report as
// gain — the same value recognised twice, once as a mark and once as a realized gain.
//
// Recorded as INCOME it is recognised once, on the statement of operations, and the units carry
// the basis that nets against their eventual sale.

const BASE = {
  company_id: 'c1', fund_id: 'f', round_name: null, transaction_date: null, notes: null,
  investment_cost: null, interest_converted: 0, shares_acquired: null, share_price: null,
  cost_basis_exited: null, proceeds_received: null, proceeds_escrow: 0, proceeds_written_off: 0,
  proceeds_per_share: null, unrealized_value_change: null, current_share_price: null,
  postmoney_valuation: null, latest_postmoney_valuation: null, exit_valuation: null,
  ownership_pct: null, portfolio_group: 'Fund I', original_currency: null,
  original_investment_cost: null, original_share_price: null, original_postmoney_valuation: null,
  original_proceeds_received: null, original_proceeds_per_share: null, original_exit_valuation: null,
  original_unrealized_value_change: null, original_current_share_price: null,
  original_latest_postmoney_valuation: null, valuation_change_source: null, fx_rate: null,
  prior_fx_rate: null, fx_value_change: null, original_position_value: null,
  created_at: null, updated_at: null,
}
const txn = (o: Partial<InvestmentTransaction> & Record<string, any>) =>
  ({ ...BASE, ...o }) as InvestmentTransaction

/** 100 units at $10. */
const PURCHASE = txn({
  id: 'buy', transaction_type: 'investment', transaction_date: '2026-01-15',
  round_name: 'Purchase', investment_cost: 1_000, shares_acquired: 100, share_price: 10,
})

/** 10 units airdropped, worth $10 each on the day. */
const AIRDROP = txn({
  id: 'air', transaction_type: 'income', transaction_date: '2026-02-01', round_name: 'Purchase',
  income_kind: 'airdrop', income_settlement: 'in_kind', income_amount: 100, shares_acquired: 10,
})

describe('income in kind', () => {
  it('adds units and basis, and is not invested capital', () => {
    const s = computeSummary([PURCHASE, AIRDROP], 'active', new Date('2026-03-01'))
    expect(s.totalShares).toBe(110)
    expect(s.totalIncome).toBe(100)
    expect(s.totalIncomeBasis).toBe(100)
    // The fund wrote a cheque for 1,000 and no more. MOIC's denominator must not grow because
    // a protocol handed over free units.
    expect(s.totalInvested).toBe(1_000)
  })

  it('does not inflate the unrealized line the way a mark would', () => {
    // At an unchanged $10 the position is 110 units = 1,100, of which 100 is the income already
    // recognised — so unrealized appreciation over total basis is nil.
    const s = computeSummary([PURCHASE, AIRDROP], 'active', new Date('2026-03-01'))
    expect(s.unrealizedValue).toBe(1_100)
    expect(s.unrealizedValue - (s.totalInvested + s.totalIncomeBasis)).toBe(0)
  })

  it('leaves MOIC measuring return on capital actually deployed', () => {
    const s = computeSummary([PURCHASE, AIRDROP], 'active', new Date('2026-03-01'))
    // 1,100 of value on 1,000 deployed. The airdrop is the gain, which is the point.
    expect(s.moic).toBeCloseTo(1.1, 10)
  })

  it('gives the units a basis to sell against', () => {
    const sale = txn({
      id: 'sell', transaction_type: 'proceeds', transaction_date: '2026-04-01',
      round_name: 'Purchase', shares_acquired: 10, proceeds_received: 100, cost_basis_exited: 100,
    })
    const s = computeSummary([PURCHASE, AIRDROP, sale], 'active', new Date('2026-05-01'))
    // Sold at exactly what it was recognised at, so there is no second gain to report.
    expect(s.totalRealized).toBe(100)
    expect(s.totalInvested + s.totalIncomeBasis - 100).toBe(1_000)
  })

  it('cash income changes no position, only the income line', () => {
    const dividend = txn({
      id: 'div', transaction_type: 'income', transaction_date: '2026-02-01',
      income_kind: 'dividend', income_settlement: 'cash', income_amount: 250,
    })
    const s = computeSummary([PURCHASE, dividend], 'active', new Date('2026-03-01'))
    expect(s.totalIncome).toBe(250)
    expect(s.totalIncomeBasis).toBe(0)
    expect(s.totalShares).toBe(100)
  })

  it('a position with no income reports zeros rather than undefined', () => {
    const s = computeSummary([PURCHASE], 'active', new Date('2026-03-01'))
    expect(s.totalIncome).toBe(0)
    expect(s.totalIncomeBasis).toBe(0)
  })
})

describe('acquisition costs', () => {
  it('capitalise into basis rather than hitting the income statement', () => {
    const withGas = txn({
      id: 'buy', transaction_type: 'investment', transaction_date: '2026-01-15',
      round_name: 'Purchase', investment_cost: 1_000, shares_acquired: 100, share_price: 10,
      fee_amount: 40,
    })
    const s = computeSummary([withGas], 'active', new Date('2026-03-01'))
    expect(s.totalInvested).toBe(1_040)
  })
})

describe('the schedule of investments', () => {
  const companies = [{
    id: 'c1', name: 'Ether', holding_type: 'crypto', status: 'active',
    industry: null, stage: null, portfolio_group: ['Fund I'],
  }] as any as SoiCompany[]

  it('counts income basis as cost', () => {
    // Leave it out and the schedule understates cost, and selling the airdropped units later
    // reports their whole proceeds as gain on top of income already recognised.
    const [p] = buildSoiPositions([PURCHASE, AIRDROP], companies, 'Fund I')
    expect(p.cost).toBe(1_100)
    expect(p.fairValue).toBe(1_100)
    expect(p.unrealized).toBe(0)
  })

  it('keeps invested capital separate from cost on the row', () => {
    const [p] = buildSoiPositions([PURCHASE, AIRDROP], companies, 'Fund I')
    expect(p.invested).toBe(1_000)
    expect(p.income).toBe(100)
  })

  it('is unchanged for a position that produced no income', () => {
    const [p] = buildSoiPositions([PURCHASE], companies, 'Fund I')
    expect(p.cost).toBe(1_000)
    expect(p.income).toBe(0)
  })
})
