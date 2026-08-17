import { describe, it, expect } from 'vitest'
import { buildSoiPositions, txnsForVehicle, type SoiCompany } from './soi'

const co = (over: Partial<SoiCompany> = {}): SoiCompany => ({
  id: 'c1', name: 'Acme Labs, Inc.', status: 'active',
  industry: ['Software'], stage: 'Series B', portfolio_group: ['Acme SPV LP'],
  ...over,
})

// Minimal shape of an investment_transactions row; computeSummary ignores the rest.
const txn = (o: any) => ({
  id: o.id ?? Math.random().toString(36).slice(2),
  company_id: o.company_id ?? 'c1',
  transaction_type: o.transaction_type,
  transaction_date: o.transaction_date ?? '2026-02-02',
  round_name: o.round_name ?? 'Series B',
  investment_cost: o.investment_cost ?? null,
  shares_acquired: o.shares_acquired ?? null,
  share_price: o.share_price ?? null,
  current_share_price: o.current_share_price ?? null,
  unrealized_value_change: o.unrealized_value_change ?? null,
  cost_basis_exited: o.cost_basis_exited ?? null,
  proceeds_received: o.proceeds_received ?? null,
  proceeds_escrow: o.proceeds_escrow ?? null,
  proceeds_written_off: o.proceeds_written_off ?? null,
  interest_converted: o.interest_converted ?? null,
  portfolio_group: o.portfolio_group ?? null,
}) as any

describe('txnsForVehicle', () => {
  it('matches the vehicle EXACTLY — never as a substring', () => {
    // The bug this guards: "Acme SPV II".includes("Acme SPV") is true.
    const txns = [
      txn({ transaction_type: 'investment', portfolio_group: 'Acme SPV', investment_cost: 100 }),
      txn({ transaction_type: 'investment', portfolio_group: 'Acme SPV II', investment_cost: 999 }),
    ]
    const got = txnsForVehicle(txns, 'Acme SPV')
    expect(got).toHaveLength(1)
    expect(got[0].investment_cost).toBe(100)
  })

  it('includes untagged company-wide price signals', () => {
    const txns = [
      txn({ transaction_type: 'investment', portfolio_group: 'Acme SPV LP', investment_cost: 100 }),
      txn({ transaction_type: 'round_info', portfolio_group: null, share_price: 12.5 }),
      txn({ transaction_type: 'investment', portfolio_group: null, investment_cost: 555 }), // untagged investment: NOT a price signal
    ]
    const got = txnsForVehicle(txns, 'Acme SPV LP')
    expect(got.map(t => t.transaction_type).sort()).toEqual(['investment', 'round_info'])
  })
})

describe('buildSoiPositions — holding type', () => {
  it('tags a fund holding so the view can render it separately', () => {
    const positions = buildSoiPositions(
      [{ id: 't1', company_id: 'c1', fund_id: 'f', transaction_type: 'investment',
         investment_cost: 1000, transaction_date: '2025-01-01', portfolio_group: 'Fund I' } as any],
      [co({ id: 'c1', name: 'Acme Ventures III', holding_type: 'fund' })],
      'Fund I',
    )
    expect(positions[0].holdingType).toBe('fund')
  })

  it('defaults to company when the column is absent or null', () => {
    const positions = buildSoiPositions(
      [{ id: 't2', company_id: 'c2', fund_id: 'f', transaction_type: 'investment',
         investment_cost: 1000, transaction_date: '2025-01-01', portfolio_group: 'Fund I' } as any],
      [co({ id: 'c2', name: 'Widget Co' })],
      'Fund I',
    )
    expect(positions[0].holdingType).toBe('company')
  })
})

describe('buildSoiPositions', () => {
  it('values priced equity at shares × the latest round price', () => {
    // A priced position marked up: 100,000 sh bought at $8.00, latest round at $12.50.
    const positions = buildSoiPositions(
      [
        txn({ transaction_type: 'investment', portfolio_group: 'Acme SPV LP', investment_cost: 800_000, shares_acquired: 100_000, share_price: 8 }),
        txn({ transaction_type: 'round_info', portfolio_group: null, share_price: 12.5 }),
      ],
      [co()],
      'Acme SPV LP',
    )
    expect(positions).toHaveLength(1)
    const p = positions[0]
    expect(p.name).toBe('Acme Labs, Inc.')
    expect(p.shares).toBe(100_000)
    expect(p.sharePrice).toBe(12.5)
    expect(p.cost).toBe(800_000)
    expect(p.fairValue).toBe(1_250_000) // 100,000 × 12.50
    expect(p.unrealized).toBe(450_000)
    expect(p.assetType).toBe('Priced equity')
    expect(p.industry).toBe('Software')
  })

  it('excludes a company the vehicle does not hold', () => {
    const positions = buildSoiPositions(
      [txn({ transaction_type: 'investment', portfolio_group: 'Some Other Fund, LP', investment_cost: 500_000, shares_acquired: 100, share_price: 5000 })],
      [co()],
      'Acme SPV LP',
    )
    expect(positions).toEqual([])
  })

  it('does not create a position from a price signal alone', () => {
    const positions = buildSoiPositions(
      [txn({ transaction_type: 'round_info', portfolio_group: null, share_price: 12.5 })],
      [co()],
      'Acme SPV LP',
    )
    expect(positions).toEqual([])
  })

  it('values an unpriced SAFE at cost plus its cumulative value change', () => {
    const positions = buildSoiPositions(
      [
        txn({ transaction_type: 'investment', portfolio_group: 'Acme SPV LP', investment_cost: 250_000, shares_acquired: 0, share_price: 0, round_name: 'SAFE' }),
        txn({ transaction_type: 'unrealized_gain_change', portfolio_group: 'Acme SPV LP', unrealized_value_change: 50_000, round_name: 'SAFE' }),
      ],
      [co()],
      'Acme SPV LP',
    )
    expect(positions[0].fairValue).toBe(300_000)
    expect(positions[0].assetType).toBe('Convertible / SAFE')
  })
})
