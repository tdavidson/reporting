import { describe, it, expect } from 'vitest'

import { MOBILE_TAB_COUNT, mobileTabsFor, navItemMatches, type NavItem } from '@/components/app-sidebar'
import type { Domain } from '@/lib/access/domains'
import type { FeatureKey } from '@/lib/types/features'
import type { AccessLevel } from '@/lib/access/effective'

/**
 * The phone's tab bar is built from the SAME list and the same resolver as the sidebar
 * — which is the point, and the thing worth pinning. A bar assembled from its own
 * hardcoded list would drift out of step with the access model the first time a domain
 * changed, and start offering pages whose every request 403s.
 */

type Access = (domain: Domain, feature?: FeatureKey) => AccessLevel

/** Everything visible — a fund admin with every feature switched on. */
const allowAll: Access = () => 'write'
/** Nothing but the entries that carry no domain at all (Settings, Support). */
const denyAll: Access = () => 'none'
const allowOnly = (...domains: Domain[]): Access => d => (domains.includes(d) ? 'write' : 'none')

describe('mobileTabsFor', () => {
  it('fills the bar and leaves the fifth slot for More', () => {
    expect(mobileTabsFor(true, allowAll)).toHaveLength(MOBILE_TAB_COUNT)
  })

  it('leads with the destinations a phone is actually used for', () => {
    expect(mobileTabsFor(true, allowAll).map(t => t.href)).toEqual([
      '/dashboard',
      '/emails',
      '/lps',
      '/funds',
    ])
  })

  it('never offers a page the user cannot open', () => {
    // The bar is an affordance, not a boundary — but a tab onto a 403 is worse than no
    // tab. Same rule the sidebar states.
    const tabs = mobileTabsFor(false, allowOnly('portfolio'))
    for (const tab of tabs) {
      const gated = tab.domain ?? tab.featureKey
      if (!gated) continue
      expect(tab.adminOnly ?? false).toBe(false)
    }
    expect(tabs.map(t => t.href)).not.toContain('/lps')
    expect(tabs.map(t => t.href)).not.toContain('/funds')
  })

  it('tops the bar up rather than leaving gaps when features are off', () => {
    // A fund running Portfolio Reporting alone still gets a full bar, not two tabs and
    // three holes.
    const tabs = mobileTabsFor(false, allowOnly('portfolio'))
    expect(tabs).toHaveLength(MOBILE_TAB_COUNT)
    expect(new Set(tabs.map(t => t.href)).size).toBe(tabs.length)
  })

  it('still gives a member with no grants somewhere to go', () => {
    // Settings and Support carry no domain, so they survive; an empty bar would be a
    // dead end in a standalone window with no address bar.
    const tabs = mobileTabsFor(false, denyAll)
    expect(tabs.length).toBeGreaterThan(0)
    expect(tabs.map(t => t.href)).toContain('/settings')
  })

  it('hides admin-only entries from a member', () => {
    const hrefs = mobileTabsFor(false, allowAll).map(t => t.href)
    expect(hrefs).not.toContain('/usage')
    expect(hrefs).not.toContain('/pending-actions')
  })
})

describe('navItemMatches', () => {
  const item = (over: Partial<NavItem>): NavItem =>
    ({ href: '/dashboard', label: 'Portfolio', icon: (() => null) as never, ...over })

  it('lights a tab on its own page and anything under it', () => {
    expect(navItemMatches(item({ href: '/lps' }), '/lps')).toBe(true)
    expect(navItemMatches(item({ href: '/lps' }), '/lps/capital')).toBe(true)
  })

  it('lights a tab on a child that lives at an unrelated path', () => {
    // Portfolio's children are /investments, /notes, /letters. Prefix-matching the
    // parent alone would leave the bar showing nothing selected across most of the app.
    const portfolio = item({ href: '/dashboard', children: [{ href: '/investments', label: 'Investments' }] })
    expect(navItemMatches(portfolio, '/investments')).toBe(true)
    expect(navItemMatches(portfolio, '/investments/abc')).toBe(true)
  })

  it('does not light a tab on a path that merely starts with the same characters', () => {
    expect(navItemMatches(item({ href: '/lps' }), '/lps-preview')).toBe(false)
    expect(navItemMatches(item({ href: '/deals' }), '/dealflow')).toBe(false)
  })
})
