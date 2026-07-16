import { describe, it, expect } from 'vitest'

/**
 * The middleware denies any /api path it cannot resolve to a registry key, so a matcher bug is an
 * outage rather than a leak. That trade is only acceptable if the matcher is right — hence the
 * round-trip below over EVERY key in the registry, not a handful of examples.
 */

import { matchRoute } from './match-route'
import { ROUTE_DOMAINS, UNGATED_ROUTES } from './route-domains'

const allKeys = [...Object.keys(ROUTE_DOMAINS), ...Object.keys(UNGATED_ROUTES)]

/** 'api/deals/[id]' → '/api/deals/sample-id' — a concrete path a client would really send. */
function concretePath(key: string): string {
  return '/' + key.split('/').map((s, i) => (s.startsWith('[') ? `sample-${i}` : s)).join('/')
}

describe('matchRoute', () => {
  it('round-trips every registry key through a concrete path', () => {
    const broken: string[] = []
    for (const key of allKeys) {
      const got = matchRoute(concretePath(key))
      if (got !== key) broken.push(`${concretePath(key)} → ${got ?? 'null'} (expected ${key})`)
    }
    expect(broken, `\nPaths that resolve to the wrong entry:\n${broken.join('\n')}`).toEqual([])
  })

  it('prefers a literal path over a dynamic one that also fits', () => {
    // Both 'api/lps/snapshots/[id]/share' and 'api/lps/snapshots/from-live' are 4 segments; the
    // literal must win or a real request to from-live gets the wrong domain.
    expect(matchRoute('/api/lps/snapshots/from-live')).toBe('api/lps/snapshots/from-live')
    expect(matchRoute('/api/lps/snapshots/abc/share')).toBe('api/lps/snapshots/[id]/share')
    expect(matchRoute('/api/deals/manual')).toBe('api/deals/manual')
    expect(matchRoute('/api/deals/abc-123')).toBe('api/deals/[id]')
  })

  it('does not match a path with the wrong number of segments', () => {
    expect(matchRoute('/api/deals/abc/extra/deep')).toBeNull()
    expect(matchRoute('/api')).toBeNull()
  })

  it('returns null for paths the registry has never heard of', () => {
    expect(matchRoute('/api/does-not-exist')).toBeNull()
    expect(matchRoute('/dashboard')).toBeNull()
  })

  it('tolerates trailing and leading slashes', () => {
    expect(matchRoute('api/deals')).toBe('api/deals')
    expect(matchRoute('/api/deals/')).toBe('api/deals')
  })

  it('resolves the routes whose gating matters most', () => {
    expect(matchRoute('/api/accounting/deal-carry')).toBe('api/accounting/deal-carry')
    expect(matchRoute('/api/accounting/gp-economics')).toBe('api/accounting/gp-economics')
    expect(matchRoute('/api/diligence/xyz/notes/n1')).toBe('api/diligence/[id]/notes/[noteId]')
    expect(matchRoute('/api/lps/investors')).toBe('api/lps/investors')
  })
})
