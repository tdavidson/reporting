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

  it('surfaces the LP question once that grant exists', () => {
    // There is deliberately no accounting chip: the books are worked on their own pages, not
    // asked about from the landing page, so the accounting grant alone adds nothing here.
    const ids = suggestedPrompts(only('read', 'portfolio', 'accounting', 'lp_capital')).map(p => p.id)
    expect(ids).toEqual(['portfolio-quarter', 'portfolio-silent', 'lp-unfunded'])
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
    const ids = createActions(only('write', 'portfolio', 'accounting'), { isAdmin: true }).map(a => a.id)
    expect(ids).toContain('add-company')
    expect(ids).toContain('add-vehicle')
  })

  it('offers Add a vehicle to admins only, whatever the grant says', () => {
    // A new vehicle is a new set of books: fund setup, not day-to-day entry.
    expect(createActions(only('write', 'accounting')).map(a => a.id)).not.toContain('add-vehicle')
    expect(createActions(only('write', 'accounting'), { isAdmin: true }).map(a => a.id)).toContain('add-vehicle')
  })

  it('leads with Add investment — the action a fund takes most often', () => {
    const ids = createActions(only('write', 'portfolio')).map(a => a.id)
    expect(ids[0]).toBe('add-investment')
  })

  it('gates Add investment on the investments feature, not just the portfolio grant', () => {
    // The feature switch is the same one the company page and the investments API honour.
    const noInvestments: Can = (domain, feature) =>
      domain === 'portfolio' && feature !== 'investments' ? 'write' : 'none'
    const ids = createActions(noInvestments).map(a => a.id)
    expect(ids).toContain('add-company')
    expect(ids).not.toContain('add-investment')
  })

  it('offers a capital call and a distribution only with lp_capital write, inside a visible Entities section', () => {
    // They post to /api/accounting/capital-calls and /distributions, which are lp_capital routes:
    // the accounting grant alone opens the books but not the partners' capital …
    expect(createActions(only('write', 'accounting')).map(a => a.id)).not.toContain('issue-capital-call')
    // … and the page they open sits under Entities, so with that section hidden there is nowhere
    // for the shortcut to go.
    expect(createActions(only('write', 'lp_capital')).map(a => a.id)).not.toContain('issue-capital-call')
    const ids = createActions(only('write', 'lp_capital', 'accounting')).map(a => a.id)
    expect(ids).toContain('issue-capital-call')
    expect(ids).toContain('declare-distribution')
  })

  it('follows the LPs visibility setting, not the accounting one, for the capital pair', () => {
    // The fund's "who sees partner capital" choice is the `lps` feature (lp_capital's primary
    // feature). The resolver is asked with no feature override, so that setting is what answers —
    // the same question the nav asks for the Capital accounts entry and the middleware asks for
    // the routes. Here the accounting feature is wide open and LPs is off: nothing is offered.
    const lpsOff: Can = (domain, feature) =>
      domain === 'lp_capital' && feature === undefined ? 'none'
      : domain === 'accounting' || domain === 'lp_capital' ? 'write'
      : 'none'
    expect(createActions(lpsOff).map(a => a.id)).not.toContain('issue-capital-call')
  })

  it('keeps the capital pair on a row of their own', () => {
    const groups = new Map(createActions(() => 'write').map(a => [a.id, a.group]))
    expect(groups.get('issue-capital-call')).toBe('capital')
    expect(groups.get('declare-distribution')).toBe('capital')
    expect(groups.get('add-investment')).toBe('create')
  })

  it('sends the capital actions to the capital accounts page with the panel to open', () => {
    const byId = new Map(createActions(() => 'write').map(a => [a.id, a]))
    expect(byId.get('issue-capital-call')?.href).toBe('/funds/capital-accounts?action=call')
    expect(byId.get('declare-distribution')?.href).toBe('/funds/capital-accounts?action=distribution')
  })

  it('gives every link action an href and every modal action none', () => {
    for (const a of createActions(() => 'write')) {
      if (a.kind === 'link') expect(a.href, a.id).toBeTruthy()
      else expect(a.href, a.id).toBeUndefined()
    }
  })
})
