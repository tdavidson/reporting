import { describe, it, expect } from 'vitest'
import {
  API_YEARS,
  isHeldMoreThan,
  isLongTerm,
  splitDisposalGain,
  splitGains,
  totalGain,
  type DisposalGain,
} from './holding-period'
import type { DisposalBasis } from '@/lib/portfolio/lots'

function disposal(over: Partial<DisposalBasis> & Pick<DisposalBasis, 'date'>): DisposalBasis {
  return {
    txnId: 'txn-1',
    units: 100,
    computedBasis: 0,
    recordedBasis: null,
    allocations: [],
    unmatchedUnits: 0,
    ...over,
  }
}

describe('isLongTerm', () => {
  it('is short-term ON the one-year anniversary', () => {
    // §1223: the holding period starts the day AFTER acquisition, so the anniversary itself is
    // still one day short. This is the whole rule.
    expect(isLongTerm('2025-01-15', '2026-01-15')).toBe(false)
  })

  it('is long-term the day after the anniversary', () => {
    expect(isLongTerm('2025-01-15', '2026-01-16')).toBe(true)
  })

  it('is short-term well inside a year', () => {
    expect(isLongTerm('2025-06-01', '2026-05-31')).toBe(false)
  })

  it('handles a leap-day acquisition without throwing', () => {
    expect(isLongTerm('2024-02-29', '2025-02-28')).toBe(false)
    expect(isLongTerm('2024-02-29', '2025-03-02')).toBe(true)
  })

  it('refuses to guess on missing or unparseable dates', () => {
    expect(isLongTerm('', '2026-01-16')).toBe(false)
    expect(isLongTerm('not-a-date', '2026-01-16')).toBe(false)
  })
})

describe('splitDisposalGain', () => {
  it('splits one sale across lots on both sides of the line', () => {
    // The trap this module exists for: an old position sold in one go, where part of the basis
    // came from a recent round. Reporting it all long-term would be plausible and wrong.
    const d: DisposalGain = {
      proceeds: 300_000,
      basis: disposal({
        date: '2026-06-30',
        recordedBasis: 100_000,
        allocations: [
          { lotTxnId: 'old', lotDate: '2023-01-10', units: 50, cost: 50_000 },
          { lotTxnId: 'new', lotDate: '2026-03-01', units: 50, cost: 50_000 },
        ],
      }),
    }
    const s = splitDisposalGain(d)
    expect(s.longTerm).toBe(100_000)
    expect(s.shortTerm).toBe(100_000)
    expect(totalGain(s)).toBe(200_000)
  })

  it('apportions gain by each lot’s share of basis, not by units', () => {
    const d: DisposalGain = {
      proceeds: 400_000,
      basis: disposal({
        date: '2026-06-30',
        recordedBasis: 100_000,
        allocations: [
          { lotTxnId: 'cheap', lotDate: '2020-01-01', units: 90, cost: 10_000 },
          { lotTxnId: 'dear', lotDate: '2026-01-01', units: 10, cost: 90_000 },
        ],
      }),
    }
    const s = splitDisposalGain(d)
    expect(s.longTerm).toBe(30_000) // 10% of the 300k gain
    expect(s.shortTerm).toBe(270_000)
  })

  it('leaves average-cost gain undetermined rather than guessing', () => {
    // Average cost produces no lot allocations, so there is nothing to date the gain against.
    // Calling it long-term would be a silent guess in the taxpayer's favour.
    const s = splitDisposalGain({
      proceeds: 500_000,
      basis: disposal({ date: '2026-06-30', recordedBasis: 200_000, allocations: [] }),
    })
    expect(s).toEqual({ shortTerm: 0, longTerm: 0, longTermWithinApiPeriod: 0, undetermined: 300_000 })
  })

  it('prefers the recorded basis over the computed one', () => {
    // Same posture as lots.ts: the books win, and a disagreement is reported elsewhere rather
    // than silently restated here.
    const s = splitDisposalGain({
      proceeds: 300_000,
      basis: disposal({
        date: '2026-06-30',
        computedBasis: 100_000,
        recordedBasis: 250_000,
        allocations: [{ lotTxnId: 'a', lotDate: '2020-01-01', units: 100, cost: 100_000 }],
      }),
    })
    expect(s.longTerm).toBe(50_000)
  })

  it('reports a loss on the correct side', () => {
    const s = splitDisposalGain({
      proceeds: 40_000,
      basis: disposal({
        date: '2026-06-30',
        recordedBasis: 100_000,
        allocations: [{ lotTxnId: 'a', lotDate: '2026-01-01', units: 100, cost: 100_000 }],
      }),
    })
    expect(s.shortTerm).toBe(-60_000)
    expect(s.longTerm).toBe(0)
  })

  it('is nothing when proceeds equal basis', () => {
    const s = splitDisposalGain({
      proceeds: 100_000,
      basis: disposal({ date: '2026-06-30', recordedBasis: 100_000 }),
    })
    expect(totalGain(s)).toBe(0)
  })

  it('ties the parts to the whole when the split does not divide evenly', () => {
    const s = splitDisposalGain({
      proceeds: 100.01,
      basis: disposal({
        date: '2026-06-30',
        recordedBasis: 0,
        allocations: [
          { lotTxnId: 'a', lotDate: '2020-01-01', units: 1, cost: 1 },
          { lotTxnId: 'b', lotDate: '2020-01-01', units: 1, cost: 1 },
          { lotTxnId: 'c', lotDate: '2026-01-01', units: 1, cost: 1 },
        ],
      }),
    })
    expect(totalGain(s)).toBe(100.01)
  })
})

describe('splitGains', () => {
  it('sums a year of disposals', () => {
    const s = splitGains([
      {
        proceeds: 200_000,
        basis: disposal({
          date: '2026-03-01',
          recordedBasis: 100_000,
          allocations: [{ lotTxnId: 'a', lotDate: '2021-01-01', units: 10, cost: 100_000 }],
        }),
      },
      {
        proceeds: 150_000,
        basis: disposal({
          date: '2026-09-01',
          recordedBasis: 100_000,
          allocations: [{ lotTxnId: 'b', lotDate: '2026-01-01', units: 10, cost: 100_000 }],
        }),
      },
    ])
    expect(s.longTerm).toBe(100_000)
    expect(s.shortTerm).toBe(50_000)
  })

  it('is empty for a year with no disposals', () => {
    expect(splitGains([])).toEqual({ shortTerm: 0, longTerm: 0, longTermWithinApiPeriod: 0, undetermined: 0 })
  })
})

describe('the §1061 three-year band', () => {
  it('marks long-term gain from an asset held under three years', () => {
    // Long-term to every ordinary partner, short-term to a carry recipient.
    const s = splitDisposalGain({
      proceeds: 300_000,
      basis: disposal({
        date: '2026-06-30',
        recordedBasis: 100_000,
        allocations: [{ lotTxnId: 'a', lotDate: '2024-06-01', units: 100, cost: 100_000 }],
      }),
    })
    expect(s.longTerm).toBe(200_000)
    expect(s.longTermWithinApiPeriod).toBe(200_000)
  })

  it('leaves gain from an asset held over three years outside the band', () => {
    const s = splitDisposalGain({
      proceeds: 300_000,
      basis: disposal({
        date: '2026-06-30',
        recordedBasis: 100_000,
        allocations: [{ lotTxnId: 'a', lotDate: '2020-01-01', units: 100, cost: 100_000 }],
      }),
    })
    expect(s.longTerm).toBe(200_000)
    expect(s.longTermWithinApiPeriod).toBe(0)
  })

  it('applies the day-after convention at three years too', () => {
    expect(isHeldMoreThan('2023-06-30', '2026-06-30', API_YEARS)).toBe(false)
    expect(isHeldMoreThan('2023-06-30', '2026-07-01', API_YEARS)).toBe(true)
  })

  it('splits one disposal across both sides of the three-year line', () => {
    const s = splitDisposalGain({
      proceeds: 400_000,
      basis: disposal({
        date: '2026-06-30',
        recordedBasis: 200_000,
        allocations: [
          { lotTxnId: 'old', lotDate: '2019-01-01', units: 50, cost: 100_000 },
          { lotTxnId: 'mid', lotDate: '2024-06-01', units: 50, cost: 100_000 },
        ],
      }),
    })
    expect(s.longTerm).toBe(200_000)
    expect(s.longTermWithinApiPeriod).toBe(100_000)
  })

  it('never counts short-term gain in the band', () => {
    // The band is a subset of LONG-term gain. Gain already short-term needs no recharacterising.
    const s = splitDisposalGain({
      proceeds: 200_000,
      basis: disposal({
        date: '2026-06-30',
        recordedBasis: 100_000,
        allocations: [{ lotTxnId: 'a', lotDate: '2026-01-01', units: 100, cost: 100_000 }],
      }),
    })
    expect(s.shortTerm).toBe(100_000)
    expect(s.longTermWithinApiPeriod).toBe(0)
  })
})
