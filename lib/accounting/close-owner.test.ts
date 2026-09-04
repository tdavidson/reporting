import { describe, it, expect } from 'vitest'
import { ownerCloseEntries } from './close-owner'
import { isBalanced, accountBalances } from './ledger'
import { chartForVehicleKind, INDIVIDUAL_CHART, MANAGEMENT_COMPANY_CHART, DEFAULT_CHART, GP_ENTITY_CHART } from './chart'
import { closesToOwnerEquity } from '@/lib/vehicle-kinds'

const ctx = {
  fundId: 'f', bridgeId: 'bridge', ownerCapitalId: 'owner',
  periodStart: '2025-01-01', periodEnd: '2025-01-31', sourceRef: 'close:p1', label: 'Jan 2025', ownerNoun: 'the owner',
}

describe('ownerCloseEntries', () => {
  it('posts one balanced entry per category, net income to the owner, offset through the bridge', () => {
    const entries = ownerCloseEntries([
      { sourceType: 'income', label: 'Operating income', capitalEffect: 1200 },
      { sourceType: 'partnership_expense', label: 'Investment expenses', capitalEffect: -300.5 },
      { sourceType: 'valuation', label: 'Net unrealized gain / (loss)', capitalEffect: 0 },
    ], ctx)
    expect(entries).toHaveLength(2)
    for (const e of entries) expect(isBalanced(e)).toBe(true)
    expect(entries[0].memo).toBe('Jan 2025 close — Operating income to the owner')
    expect(entries[0].sourceRef).toBe('close:p1')
    expect(entries[0].sourceType).toBe('income')
    // Owner's capital is credit-normal: income credits it (negative signed), expense debits it.
    const bal = accountBalances(entries.flatMap(e => e.postings))
    expect(bal.get('owner')).toBe(-899.5)
    expect(bal.get('bridge')).toBe(899.5)
  })

  it('carries no partner on any posting', () => {
    const [e] = ownerCloseEntries([{ sourceType: 'income', label: 'Income', capitalEffect: 5 }], ctx)
    expect(e.postings.every(p => p.lpEntityId === null)).toBe(true)
  })
})

describe('kinds and charts', () => {
  it('closes the management company and the individual to owner equity, nobody else', () => {
    expect(closesToOwnerEquity('manco')).toBe(true)
    expect(closesToOwnerEquity('individual')).toBe(true)
    for (const k of ['fund', 'spv', 'direct', 'associate', 'other', null, undefined]) expect(closesToOwnerEquity(k)).toBe(false)
  })

  it('seeds each kind its own chart, and the fund chart for the rest', () => {
    expect(chartForVehicleKind('individual')).toBe(INDIVIDUAL_CHART)
    expect(chartForVehicleKind('manco')).toBe(MANAGEMENT_COMPANY_CHART)
    expect(chartForVehicleKind('associate')).toBe(GP_ENTITY_CHART)
    for (const k of ['fund', 'spv', 'direct', 'other', null]) expect(chartForVehicleKind(k)).toBe(DEFAULT_CHART)
  })

  it('gives every owner-equity chart the account the owner close needs', () => {
    for (const chart of [INDIVIDUAL_CHART, MANAGEMENT_COMPANY_CHART]) {
      expect(chart.some(a => a.subtype === 'members_capital')).toBe(true)
      expect(chart.some(a => a.subtype === 'undistributed_earnings')).toBe(true)
    }
    // The individual keeps the fund's investment side, code for code, so the schedule of
    // investments and the per-company sub-accounts work unchanged.
    for (const code of ['1000', '1100', '1200', '4000', '4200']) {
      expect(INDIVIDUAL_CHART.find(a => a.code === code)?.subtype).toBe(DEFAULT_CHART.find(a => a.code === code)?.subtype)
    }
    expect(INDIVIDUAL_CHART.some(a => a.subtype === 'lp_capital' || a.subtype === 'gp_capital')).toBe(false)
  })
})
