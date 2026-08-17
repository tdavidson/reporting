import { describe, it, expect } from 'vitest'
import { earliestPostingDate, computePayload } from './statement-package'

describe('earliestPostingDate', () => {
  it('returns the min entryDate, ignoring nulls', () => {
    expect(earliestPostingDate([
      { accountId: 'a', amount: 1, entryDate: '2026-03-01' } as any,
      { accountId: 'b', amount: -1, entryDate: '2025-11-15' } as any,
      { accountId: 'c', amount: 0, entryDate: null } as any,
    ])).toBe('2025-11-15')
  })
  it('returns null when there are no dated postings', () => {
    expect(earliestPostingDate([])).toBeNull()
    expect(earliestPostingDate([{ accountId: 'a', amount: 1, entryDate: null } as any])).toBeNull()
  })
})

describe('computePayload — fund-of-funds exhibits', () => {
  // A minimal LedgerData: the FoF block is what is under test, and every other statement
  // tolerates an empty ledger.
  const base = (fofRaw: any) => ({
    accounts: [], postings: [], capitalPostings: [], sourcedPostings: [],
    names: new Map(), txns: [], companies: [], group: 'Fund I',
    cashAccount: undefined, gpAccount: undefined, earliest: null, fofRaw,
  }) as any

  const period = { start: '2025-01-01', end: '2025-12-31', label: '2025' } as any

  it('omits the fof block entirely for a fund that holds no funds', () => {
    // The whole point of making it optional: a non-FoF package must be unchanged.
    const payload = computePayload(base(null), period)
    expect('fof' in payload).toBe(false)
  })

  it('includes the exhibits once the fund holds a fund', () => {
    const payload = computePayload(base({
      holdings: [{ id: 'f1', name: 'Acme Ventures III' }],
      terms: [{ company_id: 'f1', commitment: 5_000_000, vintage_year: 2021 }],
      events: [{ company_id: 'f1', kind: 'call', event_date: '2025-06-30', amount: 3_000_000 }],
      navs: [{ company_id: 'f1', as_of_date: '2025-09-30', reported_nav: 4_000_000, basis: 'final' }],
    }), period)

    expect(payload.fof).toBeDefined()
    expect(payload.fof!.commitments.totals.commitment).toBe(5_000_000)
    expect(payload.fof!.commitments.totals.called).toBe(3_000_000)
    expect(payload.fof!.commitments.totals.unfunded).toBe(2_000_000)
    expect(payload.fof!.performance.rows[0].name).toBe('Acme Ventures III')
    expect(payload.fof!.valuationNote[0].navAsOf).toBe('2025-09-30')
  })

  it('scopes the exhibits to the period end, not to today', () => {
    // A call after the reporting date must not appear in a statement for that period.
    const payload = computePayload(base({
      holdings: [{ id: 'f1', name: 'Acme Ventures III' }],
      terms: [{ company_id: 'f1', commitment: 5_000_000 }],
      events: [
        { company_id: 'f1', kind: 'call', event_date: '2025-06-30', amount: 1_000_000 },
        { company_id: 'f1', kind: 'call', event_date: '2026-06-30', amount: 2_000_000 },
      ],
      navs: [],
    }), period)
    expect(payload.fof!.commitments.totals.called).toBe(1_000_000)
  })
})
