import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * A MANAGEMENT COMPANY'S BOOKS MUST NOT BE REACHABLE WITH THE `accounting` GRANT ALONE.
 *
 * This is the one invariant the whole management-company feature rests on. A manco's ledger lives
 * in the same `journal_entries` / `journal_postings` / `chart_of_accounts` rows as every fund's,
 * separated only by `vehicle_id` — so every surface that turns a vehicle NAME into a ledger is a
 * potential way to read the firm's payroll with a grant that was only ever meant to open the fund's
 * books. There are a lot of those surfaces: 57 API routes, the MCP tools, the Analyst's accounting
 * context, the pending-action builders, the construction service.
 *
 * The defence is deliberately structural rather than per-caller, because per-caller is what fails:
 *
 *   1. `listVehicles` excludes management companies, so `resolveVehicle` — which every one of those
 *      surfaces goes through — cannot resolve one by default. A caller that forgets gets "unknown
 *      vehicle", not the payroll.
 *   2. Exactly two callers opt in (`includeManagementCompanies`), both in http-vehicle.ts, and both
 *      immediately check the `management_company` grant.
 *
 * These tests read the source rather than executing it, for the same reason
 * route-gates-honour-grants.test.ts does: what is being asserted is that no OTHER caller acquired
 * the opt-in, and that is a property of the codebase, not of one function's return value.
 */

import { ROUTE_DOMAINS } from '@/lib/access/route-domains'
import { PAGE_DOMAINS } from '@/lib/access/page-domains'
import { DOMAIN_META, DOMAINS } from '@/lib/access/domains'
import { DEFAULT_FEATURE_VISIBILITY } from '@/lib/types/features'
import { VEHICLE_KINDS, MANCO_KIND, isManagementCompany } from '@/lib/vehicle-kinds'

const ROOT = process.cwd()
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

/** Every .ts/.tsx under app/ and lib/, so "no other caller" is checked against the whole tree. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}
const ALL_SOURCES = [
  ...sourceFiles(path.join(ROOT, 'app')),
  ...sourceFiles(path.join(ROOT, 'lib')),
]

describe('the management company is its own access domain', () => {
  it('is in the domain list with its own feature key, off by default', () => {
    expect(DOMAINS).toContain('management_company')
    expect(DOMAIN_META.management_company.primaryFeature).toBe('management_company')
    expect(DEFAULT_FEATURE_VISIBILITY.management_company).toBe('off')
  })

  it('is NOT implied by accounting — the whole point of splitting it', () => {
    // `lp_capital` is impliedBy accounting because partner capital accounts ARE the ledger. A
    // manco's salaries are not: they appear nowhere in a fund's trial balance, so the boundary is
    // real and an implication here would silently erase it.
    expect(DOMAIN_META.management_company.impliedBy).toBeUndefined()
  })

  it('seeds every fund at "none" rather than inheriting the write default', () => {
    // A new domain has no behaviour to preserve, and this one holds the firm's payroll. Seeding it
    // like the 2026-07 domains ('write' for everyone) would hand it to every existing member the
    // moment the switch is flipped — a grant nobody made.
    const sql = read('supabase/migrations/20260903180000_management_company.sql')
    expect(sql).toMatch(/select f\.id, 'management_company', 'none'/)
    expect(sql).toMatch(/\('management_company', 'none'\)/)
  })
})

describe('manco is a vehicle kind the database and the pickers both know', () => {
  it('is in the shared vocabulary', () => {
    expect(VEHICLE_KINDS).toContain(MANCO_KIND)
    expect(isManagementCompany('manco')).toBe(true)
    expect(isManagementCompany('fund')).toBe(false)
  })

  it('is allowed by the check constraint', () => {
    const sql = read('supabase/migrations/20260903180000_management_company.sql')
    expect(sql).toMatch(/check \(kind in \('fund', 'spv', 'direct', 'associate', 'manco', 'other'\)\)/)
  })

  it('has no second copy of the kind list to drift from', () => {
    // Four copies existed before lib/vehicle-kinds.ts: the API's validation list, the create modal,
    // the edit modal and the investments filter bar. A kind added to three of them and missed in
    // the fourth is accepted-but-invisible, or offered-but-rejected, with no error either way.
    const offenders = ALL_SOURCES.filter(f => {
      if (f.endsWith(path.join('lib', 'vehicle-kinds.ts'))) return false
      return /\[\s*'fund',\s*'spv',\s*'direct',\s*'associate'/.test(readFileSync(f, 'utf8'))
    }).map(f => path.relative(ROOT, f))
    expect(offenders, `redeclare the vehicle kinds: ${offenders.join(', ')}`).toEqual([])
  })
})

describe('a manco cannot be resolved without an explicit, checked opt-in', () => {
  it('is excluded from the vehicle list every surface resolves against', () => {
    const load = read('lib/accounting/load.ts')
    // Both listVehicles and listVehiclesWithId filter it out; resolveVehicle reads the first.
    expect(load.match(/\.neq\('kind', MANCO_KIND\)/g) ?? []).toHaveLength(2)
  })

  it('only widens the candidate set when the caller asks', () => {
    const resolver = read('lib/accounting/vehicle-resolver.ts')
    expect(resolver).toContain('opts?.includeManagementCompanies')
    // And never for the "which vehicle did you mean" default, which would turn a single-fund firm
    // that adds a manco into one that gets "specify a vehicle" from every page.
    const defaultBranch = resolver.slice(resolver.indexOf('if (vehicles.length === 1)'))
    expect(defaultBranch).not.toContain('includeManagementCompanies')
  })

  it('is opted into by NOBODY except the two gates that check the grant', () => {
    const optIn = ALL_SOURCES.filter(f => /includeManagementCompanies\s*:\s*true/.test(readFileSync(f, 'utf8')))
      .map(f => path.relative(ROOT, f))
    expect(optIn).toEqual(['lib/accounting/http-vehicle.ts'])
  })

  it('checks the grant in the same function that opted in', () => {
    const http = read('lib/accounting/http-vehicle.ts')
    const fn = http.slice(http.indexOf('export async function resolveGroupOr400'))
    expect(fn).toContain('includeManagementCompanies: true')
    expect(fn).toContain('assertVehicleDomain(admin, gate, group)')
    // The opt-in must not be able to return a group WITHOUT the check having run.
    expect(fn.indexOf('assertVehicleDomain')).toBeLessThan(fn.indexOf('return group'))
  })

  it('requires the grant at the level the route declared, not merely read', () => {
    const domain = read('lib/accounting/vehicle-domain.ts')
    expect(domain).toContain("hasAccess(ctx, 'management_company', gate.need)")
  })

  it('makes the gate impossible to call without an identity to check', () => {
    // `resolveGroupOr400` takes the whole gate rather than a fund id precisely so that a new route
    // cannot call it with the tenant alone and skip the question.
    const helpers = read('lib/api-helpers.ts')
    expect(helpers).toContain("need: 'read'")
    expect(helpers).toContain("need: 'write'")
    const offenders = ALL_SOURCES.filter(f =>
      /resolveGroupOr400\(\s*admin,\s*[a-zA-Z.]*fundId/.test(readFileSync(f, 'utf8')),
    ).map(f => path.relative(ROOT, f))
    expect(offenders, `pass a fund id instead of the gate: ${offenders.join(', ')}`).toEqual([])
  })
})

describe('the manco module stands on its own grant', () => {
  it('maps every /api/manco route to management_company', () => {
    const manco = Object.entries(ROUTE_DOMAINS).filter(([k]) => k.startsWith('api/manco/'))
    expect(manco.length).toBeGreaterThan(0)
    for (const [key, entry] of manco) {
      expect(entry.domain, `${key} is not gated on management_company`).toBe('management_company')
    }
  })

  it('refuses a FUND vehicle on those routes — the same hole in the other direction', () => {
    const http = read('lib/accounting/http-vehicle.ts')
    expect(http).toContain('assertMancoVehicle')
    const mancoRoutes = ['overview', 'setup', 'intercompany']
    for (const r of mancoRoutes) {
      expect(read(`app/api/manco/${r}/route.ts`), `${r} does not restrict the vehicle`)
        .toContain('resolveMancoGroupOr400')
    }
  })

  it('gates every manco page on the domain, with the ledger pages needing accounting too', () => {
    const pages = Object.entries(PAGE_DOMAINS).filter(([k]) => k === 'manco' || k.startsWith('manco/'))
    expect(pages.length).toBeGreaterThan(1)
    for (const [key, entry] of pages) {
      expect(entry.domain, `${key}`).toBe('management_company')
    }
    // The shared ledger views call /api/accounting/*, which the middleware gates on `accounting`.
    // Admitting someone without it would render a page whose every request 403s.
    const guard = read('app/(app)/manco/guard.ts')
    expect(guard).toContain("canViewPage(page, 'management_company')")
    expect(guard).toContain("canViewPage(page, 'accounting')")
  })
})
