// Where an email can be rerouted, and what each destination costs.
//
// The mailbox is Portfolio Reporting (ROUTE_DOMAINS['api/emails/[id]/reroute'] is `portfolio`) —
// an inbound email is intake substrate, not a deal. But one of the four destinations MAKES a deal,
// and a fund that never turned the Investment Workflow product on must not be able to create one
// through the side door. So the route's domain is the minimum to call it, and this table says
// which targets additionally need their own.

import type { Domain } from './domains'

export const REROUTE_TARGETS = ['reporting', 'interactions', 'deals', 'audit'] as const
export type RerouteTarget = (typeof REROUTE_TARGETS)[number]

export function isRerouteTarget(value: unknown): value is RerouteTarget {
  return typeof value === 'string' && (REROUTE_TARGETS as readonly string[]).includes(value)
}

/**
 * The EXTRA domain this target requires, on top of the route's own. `null` = nothing beyond the
 * route's `portfolio` gate, which the middleware already enforced.
 *
 * Exhaustive by construction: a new target added to REROUTE_TARGETS without an entry here fails
 * the type check, rather than silently defaulting to ungated.
 */
export function domainForRerouteTarget(target: RerouteTarget): Domain | null {
  const EXTRA: Record<RerouteTarget, Domain | null> = {
    // Runs processDeal and writes a deal row — Investment Workflow.
    deals: 'dealflow',
    // All portfolio-side: the reporting pipeline, interaction extraction, and "file it, do
    // nothing" respectively.
    reporting: null,
    interactions: null,
    audit: null,
  }
  return EXTRA[target]
}
