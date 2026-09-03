import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CHART, GP_ENTITY_CHART, MANAGEMENT_COMPANY_CHART, chartForVehicleKind,
  INTERCOMPANY_RECEIVABLE_CODE, INTERCOMPANY_PAYABLE_CODE,
  INTERCOMPANY_RECEIVABLE_SUBTYPE, INTERCOMPANY_PAYABLE_SUBTYPE,
  intercompanyCode,
} from './chart'
import { VEHICLE_KINDS } from '@/lib/vehicle-kinds'

/**
 * The management company chart, and the two invariants that are easy to break and expensive to
 * discover: the close needs the bridge account, and the intercompany codes have to be free on
 * every chart a counterparty might be keeping.
 */
describe('management company chart', () => {
  it('has no duplicate codes', () => {
    const codes = MANAGEMENT_COMPANY_CHART.map(a => a.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('carries the undistributed-earnings bridge, without which a period cannot close', () => {
    // buildPeriodCloseEntry offsets every P&L balance to this account. A chart missing it can be
    // posted to for a year and then fails at the first close, with an error far from the cause.
    const bridge = MANAGEMENT_COMPANY_CHART.find(a => a.subtype === 'undistributed_earnings')
    expect(bridge?.code).toBe('3200')
    expect(bridge?.type).toBe('equity')
  })

  it('separates the four kinds of compensation', () => {
    const subtypes = MANAGEMENT_COMPANY_CHART.map(a => a.subtype)
    for (const s of ['salaries', 'payroll_taxes', 'benefits', 'incentive_compensation']) {
      expect(subtypes, `missing ${s}`).toContain(s)
    }
  })

  it('holds the fee billed in advance as a liability rather than income', () => {
    const deferred = MANAGEMENT_COMPANY_CHART.find(a => a.subtype === 'deferred_revenue')
    expect(deferred?.type).toBe('liability')
  })

  it('has a cash account at 1000, which resolveSideAccounts prefers by code', () => {
    const cash = MANAGEMENT_COMPANY_CHART.find(a => a.code === '1000')
    expect(cash?.subtype).toBe('cash')
  })

  it('gives the intercompany parents both a code and the subtype the balances read', () => {
    const receivable = MANAGEMENT_COMPANY_CHART.find(a => a.code === INTERCOMPANY_RECEIVABLE_CODE)
    const payable = MANAGEMENT_COMPANY_CHART.find(a => a.code === INTERCOMPANY_PAYABLE_CODE)
    expect(receivable?.subtype).toBe(INTERCOMPANY_RECEIVABLE_SUBTYPE)
    expect(receivable?.type).toBe('asset')
    expect(payable?.subtype).toBe(INTERCOMPANY_PAYABLE_SUBTYPE)
    expect(payable?.type).toBe('liability')
  })
})

describe('intercompany codes are free on every chart', () => {
  // `ensureIntercompanyAccounts` creates 1900/2900 (and sub-accounts beneath them) on WHICHEVER
  // vehicle is party to a charge — a fund, a GP entity, or another manco. If either code were
  // already taken on one of those charts, the insert would collide with an existing account and
  // the charge would fail to post on that side only, which is the one outcome intercompany.ts
  // exists to prevent.
  it('is not used by the fund or GP charts', () => {
    for (const [name, chart] of [['fund', DEFAULT_CHART], ['GP entity', GP_ENTITY_CHART]] as const) {
      const codes = new Set(chart.map(a => a.code))
      expect(codes.has(INTERCOMPANY_RECEIVABLE_CODE), `${name} chart already uses 1900`).toBe(false)
      expect(codes.has(INTERCOMPANY_PAYABLE_CODE), `${name} chart already uses 2900`).toBe(false)
    }
  })

  it('makes a sub-account code that cannot collide with its parent', () => {
    const code = intercompanyCode(INTERCOMPANY_RECEIVABLE_CODE, '0f3c9a21-1111-2222-3333-444455556666')
    expect(code).toBe('1900-0f3c9a21')
    expect(code).not.toBe(INTERCOMPANY_RECEIVABLE_CODE)
  })
})

describe('chartForVehicleKind', () => {
  it('gives a management company the manco chart', () => {
    expect(chartForVehicleKind('manco')).toBe(MANAGEMENT_COMPANY_CHART)
  })

  it('leaves the existing kinds exactly as they were', () => {
    expect(chartForVehicleKind('associate')).toBe(GP_ENTITY_CHART)
    for (const kind of ['fund', 'spv', 'direct', 'other', null, undefined]) {
      expect(chartForVehicleKind(kind)).toBe(DEFAULT_CHART)
    }
  })

  it('answers for every kind the registry allows', () => {
    // A kind added to fund_vehicles with no chart decision would silently seed the fund chart,
    // which is the bug a management company had before it was its own kind.
    for (const kind of VEHICLE_KINDS) {
      expect(chartForVehicleKind(kind).length).toBeGreaterThan(0)
    }
  })
})
