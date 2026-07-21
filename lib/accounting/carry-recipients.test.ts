import { describe, it, expect } from 'vitest'
import { resolveCarryRecipients } from './carry'
import { buildCarryEntry, type CapitalAccountMap } from './entries'
import { isBalanced, accountBalances, roundCents } from './ledger'

describe('resolveCarryRecipients', () => {
  it('uses the explicit list when present', () => {
    expect(resolveCarryRecipients([{ lpEntityId: 'x', pct: 60 }, { lpEntityId: 'y', pct: 40 }], 'gp'))
      .toEqual([{ lpEntityId: 'x', pct: 60 }, { lpEntityId: 'y', pct: 40 }])
  })
  it('falls back to the single GP at 100% when the list is empty or null', () => {
    expect(resolveCarryRecipients(null, 'gp')).toEqual([{ lpEntityId: 'gp', pct: 100 }])
    expect(resolveCarryRecipients([], 'gp')).toEqual([{ lpEntityId: 'gp', pct: 100 }])
  })
  it('returns [] when there is neither a list nor a GP', () => {
    expect(resolveCarryRecipients(null, null)).toEqual([])
  })
  it('drops malformed / zero-pct entries', () => {
    expect(resolveCarryRecipients([{ lpEntityId: 'x', pct: 0 }, { pct: 50 } as any, { lpEntityId: 'y', pct: 50 }], 'gp'))
      .toEqual([{ lpEntityId: 'y', pct: 50 }])
  })
})

describe('buildCarryEntry — multi-recipient split', () => {
  const base = { fundId: 'f', entryDate: '2026-06-30' }
  const capMap: CapitalAccountMap = new Map([
    ['a', 'cap-a'], ['b', 'cap-b'], ['g1', 'cap-g1'], ['g2', 'cap-g2'], ['g3', 'cap-g3'],
  ])

  it('splits the total across recipients by pct and stays balanced', () => {
    const e = buildCarryEntry(base, new Map([['a', 60_000], ['b', 40_000]]), capMap, 'cap-gp', 'USD', [
      { lpEntityId: 'g1', pct: 60 }, { lpEntityId: 'g2', pct: 40 },
    ])
    expect(isBalanced(e)).toBe(true)
    const bal = accountBalances(e.postings)
    expect(bal.get('cap-g1')).toBe(-60_000) // credited their 60%
    expect(bal.get('cap-g2')).toBe(-40_000)
    expect(bal.get('cap-a')).toBe(60_000) // LPs still pay the carry
    expect(bal.get('cap-b')).toBe(40_000)
  })

  it('the last recipient absorbs the rounding remainder so credits tie to the total', () => {
    const total = 100.01
    const e = buildCarryEntry(base, new Map([['a', total]]), capMap, 'cap-gp', 'USD', [
      { lpEntityId: 'g1', pct: 33 }, { lpEntityId: 'g2', pct: 33 }, { lpEntityId: 'g3', pct: 34 },
    ])
    expect(isBalanced(e)).toBe(true)
    const bal = accountBalances(e.postings)
    const credits = roundCents((bal.get('cap-g1') ?? 0) + (bal.get('cap-g2') ?? 0) + (bal.get('cap-g3') ?? 0))
    expect(credits).toBe(-total) // every cent accounted for
  })

  it('falls back to the pooled GP capital account when no recipients are given', () => {
    const e = buildCarryEntry(base, new Map([['a', 100_000]]), capMap, 'cap-gp')
    expect(isBalanced(e)).toBe(true)
    expect(accountBalances(e.postings).get('cap-gp')).toBe(-100_000)
  })
})
