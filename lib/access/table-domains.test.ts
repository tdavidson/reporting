import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The coverage test — the reason the DATABASE half of the access model will still be true in a
 * year.
 *
 * Its siblings (`route-domains.test.ts`, `page-domains.test.ts`) hold the application gates
 * exhaustive. Neither of them sees a browser that skips Next.js and talks to PostgREST directly
 * with the public anon key, which is what SEC-002 was. So a table gets the same treatment: it is
 * either mapped to a domain here, or it carries an explicit rule saying why it is shaped
 * differently — owner-private, service-role-only, reference data, or deliberately left alone.
 *
 * If this test is in your way: add your table to TABLE_RULES and give the migration matching
 * policies. Do not add an exception here.
 */

import { TABLE_RULES } from './table-domains'
import { DOMAINS } from './domains'
import { DEFAULT_FEATURE_VISIBILITY, type FeatureKey } from '@/lib/types/features'

const MIGRATIONS = path.join(process.cwd(), 'supabase', 'migrations')

const migrationSources = readdirSync(MIGRATIONS)
  .filter(f => f.endsWith('.sql'))
  .map(f => ({ file: f, sql: readFileSync(path.join(MIGRATIONS, f), 'utf8') }))

/**
 * The tables that actually exist after replaying every migration — created, MINUS dropped.
 *
 * Counting only `create table` is how the first version of this file ended up asserting policies
 * for `fund_notes`, which 20260301000002 folds into `company_notes` and drops. The migration then
 * failed on a live database with a bare `relation "public.fund_notes" does not exist`. A drop is
 * part of the schema's history too, so it is read as carefully as a create.
 */
const liveTables = (() => {
  const live: Record<string, true> = {}
  const create = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-zA-Z0-9_]+)/gi
  const drop = /drop\s+table\s+(?:if\s+exists\s+)?([^;]+);/gi
  // Filename order is apply order, so a table dropped and later recreated ends up correct.
  for (const { sql } of migrationSources) {
    create.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = create.exec(sql)) !== null) live[m[1].toLowerCase()] = true

    drop.lastIndex = 0
    let d: RegExpExecArray | null
    while ((d = drop.exec(sql)) !== null) {
      for (const name of d[1].split(',')) {
        const bare = name.trim().replace(/^public\./i, '').replace(/[";]/g, '').split(/\s+/)[0]
        if (bare) delete live[bare.toLowerCase()]
      }
    }
  }
  return Object.keys(live).sort()
})()

describe('table access registry', () => {
  it('finds the migrations at all (guards against a silently passing test)', () => {
    expect(liveTables.length).toBeGreaterThan(100)
    expect(liveTables).toContain('companies')
    expect(liveTables).toContain('pending_actions')
  })

  it('does not count a table a later migration dropped', () => {
    // The five that were in the registry when the migration first failed against a real database.
    for (const dropped of [
      'fund_notes',
      'lp_associates_overrides',
      'heartbeat_channels',
      'heartbeat_threads',
      'heartbeat_credentials',
    ]) {
      expect(liveTables, `${dropped} was dropped by a migration`).not.toContain(dropped)
    }
  })

  it('gives every live table a rule', () => {
    const unmapped = liveTables.filter(t => !(t in TABLE_RULES))
    expect(
      unmapped,
      `These tables have no entry in lib/access/table-domains.ts:\n` +
        unmapped.map(t => `  ${t}`).join('\n') +
        `\n\nAdd one. A fund-scoped table is { scope: 'fund', domain: '<domain>' } and needs ` +
        `matching policies in a migration; anything else needs a rule that says why.`,
    ).toEqual([])
  })

  it('has no rule for a table that does not exist', () => {
    // Including one that used to: a rule for a dropped table becomes a `create policy` on a
    // relation Postgres does not have, and the migration fails on push rather than in CI.
    const stale = Object.keys(TABLE_RULES).filter(t => !liveTables.includes(t))
    expect(stale, `Rules for tables that no longer exist: ${stale.join(', ')}`).toEqual([])
  })

  it('names a real domain and a real feature key', () => {
    for (const [table, rule] of Object.entries(TABLE_RULES)) {
      if (rule.scope === 'fund' || rule.scope === 'parent') {
        expect(DOMAINS, `${table} names an unknown domain`).toContain(rule.domain)
      }
      if (rule.scope === 'fund' && rule.feature) {
        expect(
          Object.keys(DEFAULT_FEATURE_VISIBILITY),
          `${table} names an unknown feature key`,
        ).toContain(rule.feature as FeatureKey)
      }
    }
  })

  it('points every parent-scoped table at a table that exists', () => {
    for (const [table, rule] of Object.entries(TABLE_RULES)) {
      if (rule.scope === 'parent') {
        expect(liveTables, `${table} joins to a missing parent`).toContain(rule.parent)
      }
    }
  })

  it('makes every non-obvious rule explain itself', () => {
    // A domain mapping is self-explanatory; every other shape is a decision someone has to be able
    // to audit later, so it carries its reason in the registry rather than in a commit message.
    for (const [table, rule] of Object.entries(TABLE_RULES)) {
      if (rule.scope === 'fund' || rule.scope === 'parent') continue
      expect((rule as { note?: string }).note, `${table} (${rule.scope}) has no note`).toBeTruthy()
    }
  })
})
