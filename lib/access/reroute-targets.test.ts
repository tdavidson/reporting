import { describe, it, expect } from 'vitest'

/**
 * Rerouting an email is one route with four destinations, and they don't all belong to the same
 * product. The mailbox itself is Portfolio Reporting (see ROUTE_DOMAINS['api/emails/[id]/reroute']),
 * but 'deals' creates a deal — Investment Workflow. The registry maps ONE domain per route: the
 * minimum to CALL it. This is the part of the payload that straddles, so it gates in the handler.
 */

import { REROUTE_TARGETS, domainForRerouteTarget, isRerouteTarget } from './reroute-targets'

describe('domainForRerouteTarget', () => {
  it('sends the deal target to dealflow — rerouting there creates a deal', () => {
    expect(domainForRerouteTarget('deals')).toBe('dealflow')
  })

  it('leaves the portfolio-side targets to the route\'s own domain', () => {
    expect(domainForRerouteTarget('reporting')).toBeNull()
    expect(domainForRerouteTarget('interactions')).toBeNull()
    expect(domainForRerouteTarget('audit')).toBeNull()
  })

  it('has an answer for every valid target (a new one cannot slip through ungated)', () => {
    for (const t of REROUTE_TARGETS) {
      expect(domainForRerouteTarget(t)).not.toBeUndefined()
    }
  })
})

describe('isRerouteTarget', () => {
  it('accepts the four targets and nothing else', () => {
    expect(REROUTE_TARGETS.every(isRerouteTarget)).toBe(true)
    expect(isRerouteTarget('diligence')).toBe(false)
    expect(isRerouteTarget('')).toBe(false)
  })
})
