import { describe, it, expect } from 'vitest'
import { computeSummary } from './investments'
import type { InvestmentTransaction, CompanyStatus } from '@/lib/types/database'

// Minimal transaction builder — computeSummary only reads a handful of fields.
let n = 0
function txn(p: Partial<InvestmentTransaction>): InvestmentTransaction {
  n += 1
  return {
    id: p.id ?? `t${n}`,
    company_id: 'co', fund_id: 'f',
    transaction_type: 'investment',
    transaction_date: '2026-01-01',
    round_name: null, investment_cost: null, interest_converted: 0,
    shares_acquired: null, share_price: null, security_type: null,
    converts_from_txn_id: null, cost_basis_exited: null,
    proceeds_received: null, proceeds_escrow: null, proceeds_written_off: null,
    unrealized_value_change: null, current_share_price: null,
    ...p,
  } as InvestmentTransaction
}
const ACTIVE = 'active' as CompanyStatus
const round = (s: ReturnType<typeof computeSummary>, name: string) => s.rounds.find(r => r.roundName === name)!

describe('computeSummary — SAFE/note conversions', () => {
  it('SAFE → Series A (different rounds): basis moves, no double count, step-up on conversion', () => {
    const safe = txn({ id: 's1', round_name: 'Seed', security_type: 'safe', investment_cost: 100_000, transaction_date: '2026-01-01' })
    const conv = txn({ id: 'c1', round_name: 'Series A', security_type: 'preferred', converts_from_txn_id: 's1',
      investment_cost: 0, shares_acquired: 50_000, share_price: 3, transaction_date: '2026-06-01' })

    // Before conversion, the SAFE is held at cost.
    const before = computeSummary([safe], ACTIVE)
    expect(before.totalInvested).toBe(100_000)
    expect(before.unrealizedValue).toBe(100_000)

    // After conversion: cost unchanged, value stepped up to the round price, SAFE round zeroed.
    const after = computeSummary([safe, conv], ACTIVE)
    expect(after.totalInvested).toBe(100_000)           // no double-counted basis
    expect(after.unrealizedValue).toBe(150_000)         // 50,000 × $3.00
    expect(round(after, 'Seed').currentValue).toBe(0)   // SAFE is gone as a live position
    expect(round(after, 'Series A').currentValue).toBe(150_000)
  })

  it('note conversion capitalizes interest and any new cash into basis', () => {
    const note = txn({ id: 'n1', round_name: 'Note', security_type: 'convertible_note', investment_cost: 100_000, transaction_date: '2026-01-01' })
    const conv = txn({ id: 'c1', round_name: 'Series A', converts_from_txn_id: 'n1', interest_converted: 4_000,
      investment_cost: 25_000, shares_acquired: 50_000, share_price: 3, transaction_date: '2026-06-01' })

    const s = computeSummary([note, conv], ACTIVE)
    expect(s.totalInvested).toBe(129_000)               // 100k principal + 4k interest + 25k new cash
    expect(s.unrealizedValue).toBe(150_000)
    expect(round(s, 'Note').currentValue).toBe(0)
  })

  it('same-round conversion (SAFE named like the priced round) needs no basis move', () => {
    const safe = txn({ id: 's1', round_name: 'Series A', security_type: 'safe', investment_cost: 100_000, transaction_date: '2026-01-01' })
    const conv = txn({ id: 'c1', round_name: 'Series A', converts_from_txn_id: 's1', shares_acquired: 50_000, share_price: 3, transaction_date: '2026-06-01' })

    const s = computeSummary([safe, conv], ACTIVE)
    expect(s.totalInvested).toBe(100_000)
    expect(s.unrealizedValue).toBe(150_000)
    expect(round(s, 'Series A').currentValue).toBe(150_000)
  })

  it('does not disturb an ordinary (non-conversion) investment', () => {
    const inv = txn({ id: 'i1', round_name: 'Series A', security_type: 'preferred', investment_cost: 100_000, shares_acquired: 50_000, share_price: 3 })
    const s = computeSummary([inv], ACTIVE)
    expect(s.totalInvested).toBe(100_000)
    expect(s.unrealizedValue).toBe(150_000)
  })
})
