import { describe, it, expect } from 'vitest'
import type { Domain } from '@/lib/access/domains'
import type { AccessLevel } from '@/lib/access/effective'
import { suggestedPrompts, createActions, type Can } from '@/lib/start/quick-actions'

/** A resolver that answers `level` for the listed domains and `none` for everything else. */
const only = (level: AccessLevel, ...domains: Domain[]): Can =>
  (domain) => (domains.includes(domain) ? level : 'none')

describe('/start quick actions', () => {
  it('offers only questions the Analyst has the context to answer', () => {
    const ids = suggestedPrompts(only('read', 'portfolio')).map(p => p.id)
    expect(ids).toEqual(['portfolio-quarter', 'portfolio-silent'])
  })

  it('surfaces the accounting and LP questions once those grants exist', () => {
    const ids = suggestedPrompts(only('read', 'portfolio', 'accounting', 'lp_capital')).map(p => p.id)
    expect(ids).toContain('accounting-unreconciled')
    expect(ids).toContain('lp-unfunded')
  })

  it('shows nothing to a member with no grants at all', () => {
    expect(suggestedPrompts(only('none'))).toEqual([])
    expect(createActions(only('none'))).toEqual([])
  })

  it('caps the row so the landing page does not become a menu', () => {
    const all: Can = () => 'write'
    expect(suggestedPrompts(all)).toHaveLength(4)
    expect(suggestedPrompts(all, 2)).toHaveLength(2)
  })

  it('keeps a chip in the same slot when an unrelated grant is removed', () => {
    // Ordering is by breadth, not by which grants happen to be held, so a chip does not move
    // under a user as products are switched on and off.
    const withDeals = suggestedPrompts(only('read', 'portfolio', 'dealflow'), 6).map(p => p.id)
    const withoutDeals = suggestedPrompts(only('read', 'portfolio'), 6).map(p => p.id)
    expect(withDeals.slice(0, 2)).toEqual(withoutDeals)
  })

  it('requires write for a create action — a viewer gets a form that 403s on save', () => {
    expect(createActions(only('read', 'portfolio', 'accounting'))).toEqual([])
    const ids = createActions(only('write', 'portfolio', 'accounting')).map(a => a.id)
    expect(ids).toContain('add-company')
    expect(ids).toContain('add-vehicle')
  })

  it('gives every link action an href and every modal action none', () => {
    for (const a of createActions(() => 'write')) {
      if (a.kind === 'link') expect(a.href, a.id).toBeTruthy()
      else expect(a.href, a.id).toBeUndefined()
    }
  })
})
