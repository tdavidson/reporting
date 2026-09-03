import { describe, it, expect } from 'vitest'
import { loadActualBookYear, orgClockFor, taxSourceRef } from './book-tax-run'
import { ORG_AMORTIZATION_MONTHS } from './book-tax'

describe('orgClockFor', () => {
  it('runs from the month the fund begins business, not from January', () => {
    // Begins business in October: three months of the §709 clock fall in the first tax year.
    expect(orgClockFor('2026-10-14', 2026)).toEqual({
      monthsInYear: 3,
      monthsAlreadyAmortized: 0,
      isFirstYear: true,
    })
  })

  it('gives a full first year to a fund that begins in January', () => {
    expect(orgClockFor('2026-01-02', 2026)).toEqual({
      monthsInYear: 12,
      monthsAlreadyAmortized: 0,
      isFirstYear: true,
    })
  })

  it('carries the short first year forward into the months already run', () => {
    // Oct 2026 start: 3 months in 2026, so 2027 opens with 3 already amortized.
    expect(orgClockFor('2026-10-14', 2027)).toEqual({
      monthsInYear: 12,
      monthsAlreadyAmortized: 3,
      isFirstYear: false,
    })
    expect(orgClockFor('2026-10-14', 2028)).toEqual({
      monthsInYear: 12,
      monthsAlreadyAmortized: 15,
      isFirstYear: false,
    })
  })

  it('accumulates to the 180-month horizon without overshooting it', () => {
    // Year 16 of a January fund: 180 months exactly consumed, nothing left.
    const clock = orgClockFor('2026-01-01', 2041)
    expect(clock.monthsAlreadyAmortized).toBe(ORG_AMORTIZATION_MONTHS)
  })

  it('reports nothing for a year before the fund existed', () => {
    expect(orgClockFor('2026-10-14', 2025)).toEqual({
      monthsInYear: 0,
      monthsAlreadyAmortized: 0,
      isFirstYear: false,
    })
  })
})

describe('taxSourceRef', () => {
  it('is deterministic per year, so a re-run can find what it wrote', () => {
    expect(taxSourceRef(2026)).toBe('tax:2026')
  })
})

// ---------------------------------------------------------------------------
// loadActualBookYear
// ---------------------------------------------------------------------------

const ACCOUNTS = [
  { id: 'a-1200', code: '1200' },
  { id: 'a-4200', code: '4200' },
  { id: 'a-5200', code: '5200' },
  { id: 'a-5250', code: '5250' },
]

function posting(over: Partial<Record<string, any>>) {
  return {
    account_id: 'a-4200',
    amount: 0,
    lp_entity_id: null,
    journal_entries: { entry_date: '2026-06-30', status: 'posted', source_type: null, book: 'actual' },
    ...over,
  }
}

/** Chainable fake returning the right rows per table. */
function fakeAdmin(postings: any[], vehicleName = 'Fund I') {
  const make = (rows: any[]) => {
    const q: any = {
      select: () => q,
      eq: () => q,
      in: () => q,
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: any) => void) => resolve({ data: rows, error: null }),
    }
    return q
  }
  return {
    from: (table: string) => {
      if (table === 'chart_of_accounts') return make(ACCOUNTS)
      if (table === 'journal_postings') return make(postings)
      if (table === 'fund_vehicles') return make([{ id: 'veh-1', name: vehicleName }])
      return make([])
    },
  } as any
}

describe('loadActualBookYear', () => {
  it('reports appreciation as a positive book-over-tax difference', async () => {
    // 4200 is an income account, so book credits it: appreciation of 2.5m arrives as -2,500,000.
    // Getting this sign wrong would reverse every unrealized adjustment, so it is pinned.
    const res = await loadActualBookYear(
      fakeAdmin([posting({ account_id: 'a-4200', amount: -2_500_000 })]),
      'fund-1',
      'Fund I',
      2026,
    )
    if ('error' in res) throw new Error(res.error)
    expect(res.year.unrealizedChange).toBe(2_500_000)
  })

  it('reports a write-down as a negative difference', async () => {
    const res = await loadActualBookYear(
      fakeAdmin([posting({ account_id: 'a-4200', amount: 400_000 })]),
      'fund-1',
      'Fund I',
      2026,
    )
    if ('error' in res) throw new Error(res.error)
    expect(res.year.unrealizedChange).toBe(-400_000)
  })

  it('ignores activity outside the tax year', async () => {
    const res = await loadActualBookYear(
      fakeAdmin([
        posting({ amount: -1_000_000, journal_entries: { entry_date: '2025-12-31', status: 'posted', source_type: null, book: 'actual' } }),
        posting({ amount: -250_000, journal_entries: { entry_date: '2026-03-31', status: 'posted', source_type: null, book: 'actual' } }),
      ]),
      'fund-1',
      'Fund I',
      2026,
    )
    if ('error' in res) throw new Error(res.error)
    expect(res.year.unrealizedChange).toBe(250_000)
  })

  it('ignores drafts and voids', async () => {
    const res = await loadActualBookYear(
      fakeAdmin([
        posting({ amount: -900_000, journal_entries: { entry_date: '2026-06-30', status: 'draft', source_type: null, book: 'actual' } }),
        posting({ amount: -100_000 }),
      ]),
      'fund-1',
      'Fund I',
      2026,
    )
    if ('error' in res) throw new Error(res.error)
    expect(res.year.unrealizedChange).toBe(100_000)
  })

  it('collects the carry accrual per partner, keeping both sides', async () => {
    const carryEntry = { entry_date: '2026-12-31', status: 'posted', source_type: 'carried_interest', book: 'actual' }
    const res = await loadActualBookYear(
      fakeAdmin([
        posting({ account_id: 'cap-a', amount: 60_000, lp_entity_id: 'lp-a', journal_entries: carryEntry }),
        posting({ account_id: 'cap-b', amount: 40_000, lp_entity_id: 'lp-b', journal_entries: carryEntry }),
        posting({ account_id: 'cap-gp', amount: -100_000, lp_entity_id: 'gp', journal_entries: carryEntry }),
      ]),
      'fund-1',
      'Fund I',
      2026,
    )
    if ('error' in res) throw new Error(res.error)
    // The difference is the amount the LPs bore; the GP's credit is the other side of the same
    // reallocation and must not double it.
    expect(res.year.carryAccruedOnUnrealized).toBe(100_000)
    expect(res.perLpCarry.get('lp-a')).toBe(60_000)
    expect(res.perLpCarry.get('gp')).toBe(-100_000)
  })

  it('separates organizational from syndication costs', async () => {
    const res = await loadActualBookYear(
      fakeAdmin([
        posting({ account_id: 'a-5200', amount: 60_000 }),
        posting({ account_id: 'a-5250', amount: 150_000 }),
      ]),
      'fund-1',
      'Fund I',
      2026,
    )
    if ('error' in res) throw new Error(res.error)
    expect(res.year.organizationalExpense).toBe(60_000)
    expect(res.year.syndicationExpense).toBe(150_000)
  })

  it('counts organizational costs since inception, not just this year', async () => {
    // §709's immediate deduction is computed off the total spend, so a prior-year cost still
    // affects this year's phase-out.
    const res = await loadActualBookYear(
      fakeAdmin([
        posting({ account_id: 'a-5200', amount: 40_000, journal_entries: { entry_date: '2025-11-01', status: 'posted', source_type: null, book: 'actual' } }),
        posting({ account_id: 'a-5200', amount: 20_000 }),
      ]),
      'fund-1',
      'Fund I',
      2026,
    )
    if ('error' in res) throw new Error(res.error)
    expect(res.year.organizationalExpense).toBe(20_000)
    expect(res.year.organizationalCostsToDate).toBe(60_000)
  })

  it('derives the §709 clock from the earliest posted entry when not told otherwise', async () => {
    const res = await loadActualBookYear(
      fakeAdmin([
        posting({ account_id: 'a-5200', amount: 10_000, journal_entries: { entry_date: '2026-10-05', status: 'posted', source_type: null, book: 'actual' } }),
      ]),
      'fund-1',
      'Fund I',
      2026,
    )
    if ('error' in res) throw new Error(res.error)
    expect(res.year.org).toEqual({ monthsInYear: 3, monthsAlreadyAmortized: 0, isFirstYear: true })
  })

  it('prefers an inception date the caller supplies', async () => {
    const res = await loadActualBookYear(
      fakeAdmin([posting({ account_id: 'a-5200', amount: 10_000 })]),
      'fund-1',
      'Fund I',
      2026,
      { inceptionDate: '2026-02-01' },
    )
    if ('error' in res) throw new Error(res.error)
    expect(res.year.org.monthsInYear).toBe(11)
  })
})
