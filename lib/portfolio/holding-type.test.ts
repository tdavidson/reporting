import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * A fund-of-funds holding lives in `companies` behind a `holding_type` discriminator, so
 * every COMPANY-SHAPED surface has to exclude funds or it silently starts showing them:
 * founder-email routing, sector/stage charts, default-metric seeding, LP letter aggregation.
 *
 * This exists for the same reason lib/design-tokens.test.ts and lib/access/route-domains.test.ts
 * do: the failure is invisible in review and obvious in production. A new `.from('companies')`
 * list query must either filter holding_type or be allowlisted WITH a reason.
 */

// Call sites that legitimately do NOT filter, each with the reason it does not.
const ALLOWLIST = new Map<string, string>([
  // By-id lookups: the id already identifies one holding, and the detail routes serve both kinds.
  ['app/api/companies/[id]/route.ts', 'single holding by id — serves company and fund detail alike'],
  ['app/api/companies/[id]/documents/route.ts', 'scoped to one holding by id'],
  ['app/api/companies/[id]/interactions/route.ts', 'scoped to one holding by id'],
  ['app/api/companies/[id]/investments/route.ts', 'scoped to one holding by id; fund calls post here too'],
  ['app/api/companies/[id]/metrics/route.ts', 'scoped to one holding by id'],
  ['app/api/companies/[id]/notes/route.ts', 'scoped to one holding by id'],
  ['app/api/companies/[id]/summary/route.ts', 'scoped to one holding by id'],
  ['app/api/companies/[id]/default-metrics/route.ts', 'scoped to one holding by id'],
  ['app/api/companies/[id]/default-metrics/[defaultId]/route.ts', 'scoped to one holding by id'],
  ['app/(app)/companies/[id]/page.tsx', 'scoped to one holding by id'],
  ['app/(app)/emails/[id]/page.tsx', 'resolves one holding by the email\'s company_id'],
  ['app/api/analyst/conversations/route.ts', 'resolves fund_id from one holding id'],
  ['app/api/emails/[id]/route.ts', 'resolves one holding by the email\'s company_id'],
  // Name resolution for a set of ids already gathered elsewhere. The ids came from rows that
  // reference a holding, so re-filtering by type would blank the name rather than exclude it.
  ['app/(app)/interactions/page.tsx', 'resolves names for an id set already gathered from interactions'],
  ['app/api/interactions/route.ts', 'resolves names for an id set already gathered from interactions'],
  ['app/api/notes/route.ts', 'resolves names for an id set already gathered from notes'],
  ['app/api/review/route.ts', 'resolves names for an id set already gathered from emails'],
  ['app/api/emails/save-to-drive/route.ts', 'resolves drive folders for an explicit id set'],
  ['app/api/settings/notifications/route.ts', 'validates an explicit subscribed-company id set'],
  // Intentionally all holdings.
  ['lib/vehicles.ts', 'vehicle rollups cover every holding a vehicle owns, funds included'],
  ['app/api/settings/route.ts', 'fund deletion must remove every holding, fund holdings included'],
])

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) sourceFiles(p, out)
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

const ROOTS = ['app', 'lib', 'components']
const ALL = ROOTS.flatMap(r => sourceFiles(r))

const queriesCompanies = (src: string) => /\.from\(['"]companies['"]\)/.test(src)

describe('holding_type discriminator', () => {
  it('filters holding_type on every company-shaped query', () => {
    const offenders: string[] = []
    for (const f of ALL) {
      const rel = f.replace(/\\/g, '/')
      if (ALLOWLIST.has(rel)) continue
      const src = readFileSync(f, 'utf8')
      if (!queriesCompanies(src)) continue
      if (!/holding_type/.test(src)) offenders.push(rel)
    }
    expect(offenders, `these query companies without filtering holding_type:\n${offenders.join('\n')}`).toEqual([])
  })

  it('keeps the allowlist honest', () => {
    const stale = Array.from(ALLOWLIST.keys()).filter(f => {
      if (!ALL.includes(f)) return true                       // file moved or deleted
      return !queriesCompanies(readFileSync(f, 'utf8'))        // no longer queries companies
    })
    expect(stale, `allowlist entries that no longer apply:\n${stale.join('\n')}`).toEqual([])
  })

  it('requires a reason for every allowlist entry', () => {
    for (const [f, reason] of Array.from(ALLOWLIST)) expect(reason.length, f).toBeGreaterThan(20)
  })
})
