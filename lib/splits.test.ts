import { describe, it, expect } from 'vitest'
import { splitsFrom, cumulativeFactor, splitAdjust, undatedShareRows } from './splits'
import { computeSummary } from './investments'
import type { InvestmentTransaction } from '@/lib/types/database'

const BASE = {
  company_id: 'c', fund_id: 'f', round_name: null, transaction_date: null, notes: null,
  investment_cost: null, interest_converted: 0, shares_acquired: null, share_price: null,
  cost_basis_exited: null, proceeds_received: null, proceeds_escrow: 0, proceeds_written_off: 0,
  proceeds_per_share: null, unrealized_value_change: null, current_share_price: null,
  postmoney_valuation: null, latest_postmoney_valuation: null, exit_valuation: null,
  ownership_pct: null, portfolio_group: null, original_currency: null,
  original_investment_cost: null, original_share_price: null, original_postmoney_valuation: null,
  original_proceeds_received: null, original_proceeds_per_share: null, original_exit_valuation: null,
  original_unrealized_value_change: null, original_current_share_price: null,
  original_latest_postmoney_valuation: null, valuation_change_source: null, fx_rate: null,
  prior_fx_rate: null, fx_value_change: null, original_position_value: null,
  created_at: null, updated_at: null,
}

const txn = (o: Partial<InvestmentTransaction> & { split_ratio?: number }) =>
  ({ ...BASE, ...o }) as InvestmentTransaction

const split = (date: string, ratio: number, id = `s-${date}-${ratio}`) =>
  txn({ id, transaction_type: 'split', transaction_date: date, split_ratio: ratio })

/** 100k shares at $10 = $1,000,000 of basis. The position every test below starts from. */
const purchase = txn({
  id: 'buy', transaction_type: 'investment', transaction_date: '2026-01-15',
  round_name: 'Series A', investment_cost: 1_000_000, shares_acquired: 100_000, share_price: 10,
})

describe('cumulativeFactor', () => {
  it('applies only splits effective strictly after the date', () => {
    const splits = [{ date: '2026-06-01', ratio: 2 }]
    expect(cumulativeFactor(splits, '2026-05-31')).toBe(2)
    // ON the effective date the stock already trades split-adjusted — adjusting again doubles it.
    expect(cumulativeFactor(splits, '2026-06-01')).toBe(1)
    expect(cumulativeFactor(splits, '2026-06-02')).toBe(1)
  })

  it('compounds across several splits', () => {
    const splits = [{ date: '2026-03-01', ratio: 2 }, { date: '2026-09-01', ratio: 3 }]
    expect(cumulativeFactor(splits, '2026-01-01')).toBe(6)
    expect(cumulativeFactor(splits, '2026-05-01')).toBe(3)
    expect(cumulativeFactor(splits, '2026-10-01')).toBe(1)
  })

  it('leaves an undated row alone — it cannot be placed in the history', () => {
    expect(cumulativeFactor([{ date: '2026-06-01', ratio: 2 }], null)).toBe(1)
  })
})

describe('splitsFrom', () => {
  it('returns splits in date order and ignores other types', () => {
    const rows = [split('2026-09-01', 3), purchase, split('2026-03-01', 2)]
    expect(splitsFrom(rows)).toEqual([
      { date: '2026-03-01', ratio: 2 },
      { date: '2026-09-01', ratio: 3 },
    ])
  })

  it('drops a ratio that is zero, negative or unparseable', () => {
    const bad = [
      txn({ id: 'a', transaction_type: 'split', transaction_date: '2026-03-01', split_ratio: 0 }),
      txn({ id: 'b', transaction_type: 'split', transaction_date: '2026-03-01', split_ratio: -2 }),
      txn({ id: 'c', transaction_type: 'split', transaction_date: '2026-03-01' }),
    ]
    expect(splitsFrom(bad)).toEqual([])
  })
})

describe('splitAdjust', () => {
  it('returns the identical array when there are no splits', () => {
    const rows = [purchase]
    expect(splitAdjust(rows)).toBe(rows)
  })

  it('multiplies shares and divides prices by the same factor', () => {
    const [adjusted] = splitAdjust([purchase, split('2026-06-01', 2)])
    expect(adjusted.shares_acquired).toBe(200_000)
    expect(adjusted.share_price).toBe(5)
  })

  it('leaves the historical-record columns alone', () => {
    const exit = txn({
      id: 'x', transaction_type: 'proceeds', transaction_date: '2026-02-01',
      proceeds_received: 50_000, proceeds_per_share: 12, original_share_price: 10,
    })
    const [adjusted] = splitAdjust([exit, split('2026-06-01', 2)])
    // What was actually received per share on the day. A later split does not rewrite it.
    expect(adjusted.proceeds_per_share).toBe(12)
    expect(adjusted.original_share_price).toBe(10)
  })

  it('does not touch the split row itself', () => {
    const s = split('2026-06-01', 2)
    const out = splitAdjust([purchase, s])
    expect(out[1]).toBe(s)
  })
})

describe('undatedShareRows', () => {
  it('is silent when the company has never split', () => {
    const undated = txn({ id: 'u', transaction_type: 'investment', shares_acquired: 500 })
    expect(undatedShareRows([purchase, undated])).toEqual([])
  })

  it('names undated share-bearing rows once a split exists', () => {
    const undated = txn({ id: 'u', transaction_type: 'investment', shares_acquired: 500 })
    const dateless = txn({ id: 'n', transaction_type: 'proceeds', proceeds_received: 10 })
    expect(undatedShareRows([purchase, undated, dateless, split('2026-06-01', 2)])).toEqual(['u'])
  })
})

// ---------------------------------------------------------------------------
// The invariant that matters: a split moves the share count and the price, and moves the
// position's VALUE by nothing. These run through computeSummary, which is what the schedule
// of investments, the statements and the close all read.
// ---------------------------------------------------------------------------
describe('computeSummary with splits', () => {
  it('leaves fair value unchanged across a 2-for-1 split', () => {
    const before = computeSummary([purchase], 'active', new Date('2026-05-01'))
    const after = computeSummary(
      [purchase, split('2026-06-01', 2), txn({
        id: 'mark', transaction_type: 'round_info', transaction_date: '2026-06-02', share_price: 5,
      })],
      'active', new Date('2026-07-01'),
    )
    expect(before.unrealizedValue).toBe(1_000_000)
    expect(after.unrealizedValue).toBe(1_000_000)
    expect(after.totalShares).toBe(200_000)
    expect(after.latestSharePrice).toBe(5)
  })

  it('is the fix for the halving bug: a post-split quote against pre-split shares', () => {
    // Without the split row, a feed price of $5 against 100k shares reports $500k — a position
    // that lost half its value overnight while nothing happened.
    const quoteOnly = computeSummary(
      [purchase, txn({
        id: 'q', transaction_type: 'round_info', transaction_date: '2026-06-02', share_price: 5,
      })],
      'active', new Date('2026-07-01'),
    )
    expect(quoteOnly.unrealizedValue).toBe(500_000)

    const withSplit = computeSummary(
      [purchase, split('2026-06-01', 2), txn({
        id: 'q', transaction_type: 'round_info', transaction_date: '2026-06-02', share_price: 5,
      })],
      'active', new Date('2026-07-01'),
    )
    expect(withSplit.unrealizedValue).toBe(1_000_000)
  })

  it('handles a reverse split', () => {
    const after = computeSummary(
      [purchase, split('2026-06-01', 0.1), txn({
        id: 'q', transaction_type: 'round_info', transaction_date: '2026-06-02', share_price: 100,
      })],
      'active', new Date('2026-07-01'),
    )
    expect(after.totalShares).toBe(10_000)
    expect(after.unrealizedValue).toBe(1_000_000)
  })

  it('does not adjust a purchase made after the split', () => {
    const later = txn({
      id: 'buy2', transaction_type: 'investment', transaction_date: '2026-07-01',
      round_name: 'Series B', investment_cost: 500_000, shares_acquired: 100_000, share_price: 5,
    })
    const s = computeSummary([purchase, split('2026-06-01', 2), later], 'active', new Date('2026-08-01'))
    // 200k adjusted from the first round + 100k bought post-split at the post-split price.
    expect(s.totalShares).toBe(300_000)
    expect(s.unrealizedValue).toBe(1_500_000)
  })

  it('compounds two splits on the same position', () => {
    const s = computeSummary(
      [purchase, split('2026-03-01', 2), split('2026-09-01', 3), txn({
        id: 'q', transaction_type: 'round_info', transaction_date: '2026-09-02', share_price: 10 / 6,
      })],
      'active', new Date('2026-10-01'),
    )
    expect(s.totalShares).toBe(600_000)
    expect(s.unrealizedValue).toBeCloseTo(1_000_000, 6)
  })

  it('reports the pre-split share count when asked for a date before the split', () => {
    // Historical statements must reproduce: as of April the stock had not split yet.
    const rows = [purchase, split('2026-06-01', 2)]
    const asOfApril = rows.filter(t => !t.transaction_date || t.transaction_date <= '2026-04-30')
    const s = computeSummary(asOfApril, 'active', new Date('2026-04-30'))
    expect(s.totalShares).toBe(100_000)
    expect(s.latestSharePrice).toBe(10)
  })
})
