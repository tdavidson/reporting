import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * SEC-002: the migration has to say what the registry says.
 *
 * There is no local Postgres in CI, so this cannot execute a policy against a real member with
 * real grants — that is what `supabase/tests/` and a running stack are for. What it CAN do is stop
 * the two artefacts drifting: the registry that a human reads (lib/access/table-domains.ts), and
 * the SQL that actually runs. A table added to one and not the other is exactly how a permissive
 * policy survives a security fix.
 *
 * It also pins the two copies of the feature defaults. `domain_access()` had to re-state
 * DEFAULT_FEATURE_VISIBILITY and DOMAIN_META.primaryFeature in SQL, and a drift there is silent in
 * both directions: a default that reads 'everyone' in Postgres and 'off' in TypeScript is a grant
 * nobody made.
 */

import { TABLE_RULES } from '@/lib/access/table-domains'
import { DOMAINS, DOMAIN_META } from '@/lib/access/domains'
import { DEFAULT_FEATURE_VISIBILITY } from '@/lib/types/features'

const MIGRATIONS = path.join(process.cwd(), 'supabase', 'migrations')
const SEC_002 = '20260902174637_enforce_domain_access_rls.sql'

/** The SEC-002 migration itself — where the resolver and the bulk re-gating live. */
const sql = readFileSync(path.join(MIGRATIONS, SEC_002), 'utf8')

/**
 * Every migration, concatenated. A table added AFTER SEC-002 states its own policies in its own
 * migration, so the rule to check is "the registry's decision is expressed somewhere", not "in
 * that one file". The naming convention below is what makes it checkable, and is the convention a
 * new table's migration is expected to follow.
 */
const orderedMigrations = readdirSync(MIGRATIONS)
  .filter(f => f.endsWith('.sql'))
  .sort()
  .map(f => ({ file: f, sql: readFileSync(path.join(MIGRATIONS, f), 'utf8') }))

const allSql = orderedMigrations.map(m => m.sql).join('\n')

/**
 * The arms of a `case <x> when 'a' then 'b' ... end` block in one of the lookup functions — from
 * the LAST migration that defines it. `create or replace function` means a later migration can
 * re-state the table (feature_default learned `tax_reporting` that way), and what Postgres runs is
 * the final definition, not the first.
 */
function caseArms(fnName: string): Record<string, string> {
  const marker = `create or replace function public.${fnName}(`
  const defining = orderedMigrations.filter(m => m.sql.includes(marker))
  expect(defining.length, `${fnName} is not defined by any migration`).toBeGreaterThan(0)
  const last = defining[defining.length - 1].sql
  const start = last.lastIndexOf(marker)
  const end = last.indexOf('$$;', start)
  const body = last.slice(start, end)
  const arms: Record<string, string> = {}
  const re = /when\s+'([a-z_]+)'\s+then\s+'([a-z_]+)'/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) arms[m[1]] = m[2]
  return arms
}

describe('SEC-002 domain RLS migration', () => {
  it('reads the migration at all (guards against a silently passing test)', () => {
    expect(sql.length).toBeGreaterThan(5000)
    expect(sql).toContain('create or replace function public.domain_access(')
  })

  it('mirrors DEFAULT_FEATURE_VISIBILITY into feature_default()', () => {
    expect(caseArms('feature_default')).toEqual(DEFAULT_FEATURE_VISIBILITY)
  })

  it('mirrors DOMAIN_META.primaryFeature into domain_primary_feature()', () => {
    const expected = Object.fromEntries(
      DOMAINS.filter(d => DOMAIN_META[d].primaryFeature).map(d => [d, DOMAIN_META[d].primaryFeature!]),
    )
    expect(caseArms('domain_primary_feature')).toEqual(expected)
  })

  it('gates every fund-scoped table on the domain the registry names — as of the LAST migration', () => {
    // "Somewhere in the migrations" is not enough. A table can be re-gated later (inbound_emails
    // moved from dealflow to portfolio once the live check showed /emails/[id] returning nothing),
    // and what the database ends up with is the LAST statement about it. So this reads the
    // migrations in apply order and checks where each table finally landed.
    const missing: string[] = []
    for (const [table, rule] of Object.entries(TABLE_RULES)) {
      if (rule.scope !== 'fund') continue
      const args = rule.feature ? `'${rule.domain}', '${rule.feature}'` : `'${rule.domain}'`

      let finalRead: string | null = null
      for (const { sql: file } of orderedMigrations) {
        const re = new RegExp(
          `create policy "${table} read needs ([a-z_]+)"\\s+on public\\.${table} for select[^;]*?` +
            `fund_ids_readable\\(([^)]*)\\)`,
          'g',
        )
        let m: RegExpExecArray | null
        while ((m = re.exec(file)) !== null) finalRead = m[2].trim()
      }

      if (finalRead === null) missing.push(`${table}: no read policy in any migration`)
      else if (finalRead !== args) missing.push(`${table}: last gated on (${finalRead}), registry says (${args})`)

      for (const verb of ['insert', 'update', 'delete']) {
        if (!allSql.includes(`create policy "${table} ${verb} needs ${rule.domain} write"`)) {
          missing.push(`${table}: no ${verb} policy for ${rule.domain}`)
        }
      }
    }
    expect(missing, missing.join('\n')).toEqual([])
  })

  it('drops the old policies whenever a migration re-gates a table', () => {
    // Creating the new policy is only half of a move: RLS policies are permissive and OR together,
    // so a stale `read needs dealflow` left in place would still hand out every row. The second
    // pass drops everything on the tables it touches before restating them.
    const restated: string[] = []
    for (const { file, sql: body } of orderedMigrations) {
      if (file <= SEC_002) continue
      const re = /create policy "([a-z_]+) read needs [a-z_]+"/g
      let m: RegExpExecArray | null
      const tables = new Set<string>()
      while ((m = re.exec(body)) !== null) tables.add(m[1])
      for (const table of Array.from(tables)) {
        // Either the file drops every policy on that table, or it is a brand-new table.
        const dropsAll = body.includes(`'${table}'`) && body.includes('drop policy if exists')
        const isNew = new RegExp(`create table[^;]*\\b${table}\\b`, 'i').test(body)
        if (!dropsAll && !isNew) restated.push(`${file}: re-gates ${table} without dropping its old policies`)
      }
    }
    expect(restated, restated.join('\n')).toEqual([])
  })

  it('states the multi-domain reads for a table no single domain owns', () => {
    for (const [table, rule] of Object.entries(TABLE_RULES)) {
      if (rule.scope !== 'multi') continue
      for (const domain of rule.read) {
        expect(allSql, `${table} has no read policy for ${domain}`).toContain(
          `create policy "${table} read needs ${domain}"`,
        )
      }
      expect(allSql, `${table} has no write policy`).toContain(
        `create policy "${table} insert needs ${rule.write} write"`,
      )
    }
  })

  it('takes the Data API away from credential and infrastructure tables', () => {
    for (const [table, rule] of Object.entries(TABLE_RULES)) {
      if (rule.scope !== 'service') continue
      expect(allSql, `${table} keeps its anon/authenticated privileges`).toContain(
        `revoke all on public.${table} from anon, authenticated;`,
      )
      expect(allSql).toContain(
        `grant select, insert, update, delete on public.${table} to service_role;`,
      )
    }
  })

  it('requires the owner, not just the fund, on owner-private tables', () => {
    for (const [table, rule] of Object.entries(TABLE_RULES)) {
      if (rule.scope !== 'owner' && rule.scope !== 'user') continue
      const policy = `create policy "${table} is private to its owner"`
      expect(allSql, `${table} has no owner policy`).toContain(policy)
      const block = allSql.slice(allSql.indexOf(policy), allSql.indexOf(policy) + 400)
      expect(block, `${table} does not compare ${rule.column} to auth.uid()`).toContain(
        `${rule.column} = auth.uid()`,
      )
    }
  })

  it('gates pending actions on the domain the row names, read to stage and write to approve', () => {
    expect(sql).toContain('using (public.can_read_domain(fund_id, domain))')
    expect(sql).toContain('with check (public.can_read_domain(fund_id, domain))')
    expect(sql).toContain('using (public.can_write_domain(fund_id, domain))')
  })

  it('names no table that a LATER migration creates', () => {
    // A migration is one step in a replay, not a view of the finished schema. The registry is
    // schema-wide and correct; this file can only touch what exists by the time it runs.
    // `api_idempotency_keys` (20260902190000) carries its own grants in its own migration, and
    // naming it here failed on push with a preflight error.
    const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
    const createdBy: Record<string, string> = {}
    for (const file of files) {
      const src = readFileSync(path.join(MIGRATIONS, file), 'utf8')
      const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-zA-Z0-9_]+)/gi
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) {
        const name = m[1].toLowerCase()
        if (!(name in createdBy)) createdBy[name] = file
      }
    }

    const premature = Object.keys(TABLE_RULES).filter(
      table => createdBy[table] > SEC_002 && sql.includes(table),
    )
    expect(
      premature,
      `SEC-002 names ${premature.join(', ')}, created later by ` +
        premature.map(t => createdBy[t]).join(', ') +
        `. Give that table its grants and policies in its own migration instead.`,
    ).toEqual([])
  })

  it('leaves the deliberately-kept tables alone', () => {
    // The membership tables and the LP-portal identity tables express something the generic shapes
    // do not, and the resolver's own inputs cannot be gated by the resolver. If one of them shows
    // up in the reset list or gains a generated policy here, that was an accident.
    const resetList = sql.slice(sql.indexOf('foreach t in array array['), sql.indexOf('] loop'))
    for (const [table, rule] of Object.entries(TABLE_RULES)) {
      if (rule.scope !== 'keep') continue
      expect(resetList, `${table} is marked 'keep' but its policies are dropped`).not.toContain(
        `'${table}'`,
      )
      expect(sql, `${table} is marked 'keep' but the migration writes a policy for it`).not.toContain(
        `on public.${table} for`,
      )
    }
  })

  it('stops using is_fund_writer, which called every member a writer everywhere', () => {
    const offenders: string[] = []
    const re = /create policy[\s\S]*?;\n/g
    let m: RegExpExecArray | null
    while ((m = re.exec(sql)) !== null) {
      if (m[0].includes('is_fund_writer(')) offenders.push(m[0])
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('re-gates every bucket that held fund data', () => {
    for (const bucket of [
      'company-documents',
      'email-attachments',
      'diligence-documents',
      'diligence-recordings',
      'style-anchor-memos',
      'lp-documents',
    ]) {
      expect(sql, `${bucket} has no new read policy`).toContain(`create policy "${bucket} read needs `)
    }
  })
})
