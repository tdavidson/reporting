import { describe, it, expect } from 'vitest'
import {
  TAX_SOURCE_TYPE,
  buildCarryReversalEntry,
  buildOrganizationalCostEntry,
  buildSyndicationCostEntry,
  buildTaxAdjustmentEntries,
  buildUnrealizedReversalEntry,
  type TaxAdjustmentAccounts,
} from './book-tax-entries'
import type { ProposedAdjustment } from './book-tax'

const ACCTS: TaxAdjustmentAccounts = {
  unrealizedAssetId: 'acct-1200',
  unrealizedIncomeId: 'acct-4200',
  organizationalExpenseId: 'acct-5200',
  deferredOrgCostsId: 'acct-1400',
  syndicationExpenseId: 'acct-5250',
  capitalizedSyndicationId: 'acct-1450',
}

const BASE = { fundId: 'fund-1', entryDate: '2026-12-31' }

const sum = (e: { postings: { amount: number }[] }) =>
  Math.round(e.postings.reduce((s, p) => s + p.amount, 0) * 100) / 100

function proposal(over: Partial<ProposedAdjustment> & Pick<ProposedAdjustment, 'kind' | 'amount'>): ProposedAdjustment {
  return { permanent: false, label: over.kind, rationale: '', ...over }
}

describe('unrealized reversal', () => {
  it('posts the exact opposite of the mark', () => {
    // Book: Dr 1200 / Cr 4200. Tax undoes it, so the position sits at cost.
    const e = buildUnrealizedReversalEntry(BASE, 2_500_000, ACCTS)
    expect(e.postings).toEqual([
      { accountId: 'acct-4200', amount: 2_500_000, currency: 'USD', lpEntityId: null },
      { accountId: 'acct-1200', amount: -2_500_000, currency: 'USD', lpEntityId: null },
    ])
    expect(sum(e)).toBe(0)
  })

  it('reverses a write-down the other way', () => {
    const e = buildUnrealizedReversalEntry(BASE, -400_000, ACCTS)
    expect(e.postings[0].amount).toBe(-400_000)
    expect(sum(e)).toBe(0)
  })
})

describe('carry reversal', () => {
  const capMap = new Map([
    ['lp-a', 'cap-a'],
    ['lp-b', 'cap-b'],
    ['gp', 'cap-gp'],
  ])

  it('reverses partner by partner, not at fund level', () => {
    // The close debited the LPs 100k and credited the GP 100k. This puts it back.
    const e = buildCarryReversalEntry(
      BASE,
      new Map([
        ['lp-a', -60_000],
        ['lp-b', -40_000],
        ['gp', 100_000],
      ]),
      capMap,
    )
    expect(sum(e)).toBe(0)
    expect(e.postings.find(p => p.lpEntityId === 'lp-a')?.amount).toBe(-60_000)
    expect(e.postings.find(p => p.lpEntityId === 'gp')?.amount).toBe(100_000)
  })

  it('drops zero lines but keeps the entry balanced', () => {
    const e = buildCarryReversalEntry(BASE, new Map([['lp-a', -50_000], ['lp-b', 0], ['gp', 50_000]]), capMap)
    expect(e.postings).toHaveLength(2)
    expect(sum(e)).toBe(0)
  })

  it('refuses a partner with no capital account rather than dropping them', () => {
    expect(() =>
      buildCarryReversalEntry(BASE, new Map([['ghost', -1_000], ['gp', 1_000]]), capMap),
    ).toThrow(/No capital account/)
  })
})

describe('capitalised costs', () => {
  it('moves the non-deductible organizational excess onto the balance sheet', () => {
    const e = buildOrganizationalCostEntry(BASE, 55_000, ACCTS)
    expect(e.postings).toEqual([
      { accountId: 'acct-1400', amount: 55_000, currency: 'USD', lpEntityId: null },
      { accountId: 'acct-5200', amount: -55_000, currency: 'USD', lpEntityId: null },
    ])
  })

  it('unwinds the organizational asset in a later year, when tax deducts and book does not', () => {
    const e = buildOrganizationalCostEntry(BASE, -4_000, ACCTS)
    expect(e.postings[0].amount).toBe(-4_000) // 1400 falls
    expect(e.postings[1].amount).toBe(4_000) //  5200 takes the deduction
  })

  it('capitalises syndication costs to their own permanent account', () => {
    // Same shape as §709 and a different account, because this balance never unwinds.
    const e = buildSyndicationCostEntry(BASE, 150_000, ACCTS)
    expect(e.postings[0].accountId).toBe('acct-1450')
    expect(e.postings[0].accountId).not.toBe(ACCTS.deferredOrgCostsId)
    expect(sum(e)).toBe(0)
  })
})

describe('buildTaxAdjustmentEntries', () => {
  it('builds one entry per non-zero difference, tagged by kind', () => {
    const { entries, skipped } = buildTaxAdjustmentEntries({
      base: BASE,
      accounts: ACCTS,
      proposals: [
        proposal({ kind: 'unrealized', amount: 1_000_000 }),
        proposal({ kind: 'syndication', amount: 50_000, permanent: true }),
      ],
    })
    expect(entries.map(e => e.sourceType)).toEqual([
      TAX_SOURCE_TYPE.unrealized,
      TAX_SOURCE_TYPE.syndication,
    ])
    expect(skipped).toEqual([])
    for (const e of entries) expect(sum(e)).toBe(0)
  })

  it('refuses a carry adjustment with no per-partner split, and says why', () => {
    // A fund-level carry entry would balance and still leave every partner's tax capital wrong —
    // worse than no entry, because it looks done.
    const { entries, skipped } = buildTaxAdjustmentEntries({
      base: BASE,
      accounts: ACCTS,
      proposals: [proposal({ kind: 'carry_on_unrealized', amount: 200_000 })],
    })
    expect(entries).toEqual([])
    expect(skipped).toEqual([
      { kind: 'carry_on_unrealized', reason: expect.stringContaining('per-partner split') },
    ])
  })

  it('builds the carry entry when the split is supplied', () => {
    const { entries, skipped } = buildTaxAdjustmentEntries({
      base: BASE,
      accounts: ACCTS,
      proposals: [proposal({ kind: 'carry_on_unrealized', amount: 200_000 })],
      carry: {
        perLpReversal: new Map([['lp-a', -200_000], ['gp', 200_000]]),
        capMap: new Map([['lp-a', 'cap-a'], ['gp', 'cap-gp']]),
      },
    })
    expect(skipped).toEqual([])
    expect(entries).toHaveLength(1)
    expect(sum(entries[0])).toBe(0)
  })

  it('skips zero-amount proposals without reporting them as failures', () => {
    const { entries, skipped } = buildTaxAdjustmentEntries({
      base: BASE,
      accounts: ACCTS,
      proposals: [proposal({ kind: 'unrealized', amount: 0 })],
    })
    expect(entries).toEqual([])
    expect(skipped).toEqual([])
  })
})
