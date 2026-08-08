import { describe, it, expect } from 'vitest'
import { periodEndMarks, valuationBasisNote, managerTieOut, STALE_NAV_DAYS } from './fof-valuation'
import type { FundPosition } from './fof-metrics'

const pos = (over: Partial<FundPosition>): FundPosition => ({
  companyId: 'f1', name: 'Acme Ventures III', managerName: 'Acme', vintageYear: 2021,
  strategy: 'Early stage', commitment: 5_000_000, contributed: 3_000_000, distributed: 0,
  recallableReturned: 0, unfunded: 2_000_000, pctCalled: 0.6,
  reportedNav: 4_000_000, navAsOf: '2025-09-30', navBasis: 'final', stalenessDays: 92,
  carryingValue: 4_000_000, dpi: 0, rvpi: 1.33, tvpi: 1.33, netIrr: 0.15,
  ...over,
})

describe('periodEndMarks', () => {
  it('emits the delta between derived carrying value and what the ledger carries', () => {
    const marks = periodEndMarks([pos({})], new Map([['f1', 3_600_000]]), '2025-12-31')
    expect(marks).toHaveLength(1)
    expect(marks[0]).toMatchObject({
      companyId: 'f1', periodEnd: '2025-12-31',
      derivedCarrying: 4_000_000, ledgerCarrying: 3_600_000, delta: 400_000,
    })
  })

  it('emits a negative delta when the position has fallen', () => {
    const marks = periodEndMarks([pos({ carryingValue: 3_000_000 })], new Map([['f1', 3_600_000]]), '2025-12-31')
    expect(marks[0].delta).toBe(-600_000)
  })

  it('emits nothing when the ledger already agrees', () => {
    expect(periodEndMarks([pos({})], new Map([['f1', 4_000_000]]), '2025-12-31')).toEqual([])
  })

  it('treats a holding absent from the ledger as carrying zero', () => {
    // A holding whose calls were all memo-only (before ledger_start_date) has no ledger
    // balance yet. It still needs its first mark.
    const marks = periodEndMarks([pos({})], new Map(), '2025-12-31')
    expect(marks[0].ledgerCarrying).toBe(0)
    expect(marks[0].delta).toBe(4_000_000)
  })

  it('ignores sub-cent differences rather than posting noise', () => {
    expect(periodEndMarks([pos({})], new Map([['f1', 4_000_000.004]]), '2025-12-31')).toEqual([])
  })

  it('returns one mark per disagreeing holding', () => {
    const marks = periodEndMarks(
      [pos({}), pos({ companyId: 'f2', name: 'Beta II', carryingValue: 1_000_000 })],
      new Map([['f1', 4_000_000], ['f2', 900_000]]),
      '2025-12-31',
    )
    expect(marks.map(m => m.companyId)).toEqual(['f2'])
  })
})

describe('valuationBasisNote', () => {
  it('lists each position with its as-of date, basis and staleness', () => {
    const rows = valuationBasisNote([
      pos({}),
      pos({ companyId: 'f2', name: 'Beta II', navBasis: 'estimate', stalenessDays: 0, carryingValue: 1_000_000, reportedNav: 1_000_000 }),
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: 'Acme Ventures III', navAsOf: '2025-09-30', basis: 'final', stalenessDays: 92 })
    expect(rows[1].basis).toBe('estimate')
  })

  it('marks a position whose carrying value was rolled forward', () => {
    // reportedNav 4.0m but carrying 4.5m => 0.5m of cash flow was rolled forward, and the
    // disclosure has to say so — that is the difference between a reported NAV and our figure.
    const rows = valuationBasisNote([pos({ carryingValue: 4_500_000 })])
    expect(rows[0].rolledForward).toBe(true)
  })

  it('does not mark a position carried exactly at its reported NAV', () => {
    expect(valuationBasisNote([pos({})])[0].rolledForward).toBe(false)
  })

  it('describes a position with no statement as unreported rather than as final', () => {
    const rows = valuationBasisNote([pos({ reportedNav: null, navAsOf: null, navBasis: null, stalenessDays: null, carryingValue: 3_000_000 })])
    expect(rows[0].navAsOf).toBeNull()
    expect(rows[0].basis).toBe('unreported')
    expect(rows[0].rolledForward).toBe(false)
  })
})

describe('managerTieOut', () => {
  it('flags where our register disagrees with the manager statement', () => {
    const rows = managerTieOut(
      [pos({ contributed: 3_000_000, distributed: 0, unfunded: 2_000_000 })],
      [{ companyId: 'f1', reportedContributions: 3_500_000, reportedDistributions: 0, reportedUnfunded: 1_500_000 }],
    )
    // A 500k gap on contributions is a call notice we never received.
    expect(rows.find(r => r.field === 'contributions')).toMatchObject({
      ours: 3_000_000, theirs: 3_500_000, difference: -500_000,
    })
    expect(rows.find(r => r.field === 'unfunded')?.difference).toBe(500_000)
  })

  it('returns nothing when everything agrees', () => {
    const rows = managerTieOut(
      [pos({ contributed: 3_000_000, distributed: 0, unfunded: 2_000_000 })],
      [{ companyId: 'f1', reportedContributions: 3_000_000, reportedDistributions: 0, reportedUnfunded: 2_000_000 }],
    )
    expect(rows).toEqual([])
  })

  it('skips fields the manager did not report', () => {
    const rows = managerTieOut(
      [pos({})],
      [{ companyId: 'f1', reportedContributions: null, reportedDistributions: null, reportedUnfunded: null }],
    )
    expect(rows).toEqual([])
  })

  it('skips a holding with no manager statement at all', () => {
    expect(managerTieOut([pos({})], [])).toEqual([])
  })
})

describe('STALE_NAV_DAYS', () => {
  it('is one quarter plus slack for a manager reporting on day 95', () => {
    // Exported so the close warning and the schedule of investments agree on what "stale"
    // means. Two surfaces disagreeing is worse than either threshold being wrong.
    expect(STALE_NAV_DAYS).toBe(100)
  })
})
