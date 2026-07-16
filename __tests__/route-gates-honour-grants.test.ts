import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The grants must not be vetoed by the routes they govern.
 *
 * This is the test that was missing when the whole access model shipped "green": 532 tests passed
 * while `accounting` grants were inert on 20 of 20 routes, because every test asserted the
 * MAPPING and none asserted that the handler would actually serve. `assertReadAccess` refused any
 * plain member outright and ran AFTER the middleware, so an admin could set Fund accounting to
 * "Members", grant someone write, and watch every route 403 them anyway — while that same person
 * read the books through the Analyst and MCP, which had already moved to the real resolver.
 *
 * A second, coarser, contradictory policy is not defence in depth. It is a bug that only ever
 * fires on the people you meant to let in. So: `assertAdminAccess` belongs to the `admin` domain
 * and nowhere else.
 */

import { ROUTE_DOMAINS } from '@/lib/access/route-domains'

const API_DIR = path.join(process.cwd(), 'app', 'api')

const routeFile = (key: string) => path.join(API_DIR, key.replace(/^api\//, ''), 'route.ts')

function read(key: string): string {
  try {
    return readFileSync(routeFile(key), 'utf8')
  } catch {
    return ''
  }
}

describe('route gates honour the per-domain grants', () => {
  it('uses assertAdminAccess ONLY on routes in the admin domain', () => {
    const offenders = Object.entries(ROUTE_DOMAINS)
      .filter(([, entry]) => entry.domain !== 'admin')
      .filter(([key]) => /assertAdminAccess\s*\(/.test(read(key)))
      .map(([key, entry]) => `${key} (domain: ${entry.domain})`)

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `\n\nThese routes are gated on the ADMIN ROLE but belong to a granted domain, so a member\n` +
          `holding that grant is refused and the grant means nothing:\n${offenders.map(o => `  - ${o}`).join('\n')}\n\n` +
          `The middleware already checked this route's domain. Use assertWriteAccess (which keeps\n` +
          `the read-only demo out) or assertReadAccess. See docs/plan-access-control.md.\n`,
    ).toEqual([])
  })

  it('finds the routes it claims to check (guards against a vacuous pass)', () => {
    // If the path mapping ever breaks, every read() returns '' and the test above passes for the
    // wrong reason.
    expect(read('api/accounting/journal')).toContain('export async function')
    expect(read('api/settings/access')).toContain('assertAdminAccess')
  })

  it('keeps the admin domain admin-gated in the route as well as the boundary', () => {
    // The one place the role check is the real policy rather than a stand-in — worth defence in
    // depth, because it is the control panel for everyone else's access.
    expect(read('api/settings/access')).toMatch(/assertAdminAccess\s*\(/)
  })
})
