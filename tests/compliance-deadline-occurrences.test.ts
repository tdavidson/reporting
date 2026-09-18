import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

// Regression test for compliance_deadlines per-occurrence refactor.
// The migration that replaces (fund_id, compliance_item_id, year, portfolio_group) uniqueness
// with (fund_id, compliance_item_id, portfolio_group, year, quarter) must drop the old constraint
// and add the new one with quarter, so a fund can hold one row per quarter.

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const migrations = readdirSync(MIGRATIONS)
  .filter(f => f.endsWith('.sql'))
  .sort()
  .map(f => ({ name: f, sql: readFileSync(join(MIGRATIONS, f), 'utf8') }))

const sql = migrations.map(m => m.sql).join('\n')

describe('compliance_deadlines per-occurrence refactor', () => {
  it('drops the fund_item_year_group_uniq constraint after 20260312100004', () => {
    const vehicleScopeIdx = migrations.findIndex(m => m.name.includes('20260312100004'))
    const occurrenceIdx = migrations.findIndex(m => m.sql.includes('compliance_deadlines_occurrence_key'))

    expect(vehicleScopeIdx).toBeGreaterThanOrEqual(0)
    expect(occurrenceIdx).toBeGreaterThan(vehicleScopeIdx)

    const relevantMigrations = migrations.slice(vehicleScopeIdx + 1)
    const found = relevantMigrations.some(m =>
      m.sql.includes('drop constraint if exists compliance_deadlines_fund_item_year_group_uniq'),
    )
    expect(found).toBe(true)
  })

  it('adds the occurrence_key constraint with quarter', () => {
    expect(sql).toMatch(/add constraint compliance_deadlines_occurrence_key\s+unique\s*\(\s*fund_id,\s*compliance_item_id,\s*portfolio_group,\s*year,\s*quarter\s*\)/i)
  })

  // A completion only carries into the current year if it happened on/after the start of the
  // period it would mark — a Q4 valuation completed in January (for last year's Q4) must not
  // become "this year's Q4 filed" and suppress the first real reminder cycle.
  it('backfills a completion only when completed_at falls in the period it would mark', () => {
    const backfill = migrations.find(m => m.name.startsWith('20260918000001'))!.sql
    const where = backfill.slice(backfill.indexOf('from public.compliance_fund_settings s'))
    expect(where).toMatch(/s\.completed_at is null/)
    expect(where).toMatch(/make_date\(extract\(year from now\(\)\)::int, 3 \* [^,]+ - 2, 1\)/)
    expect(where).toContain("date_trunc('year', now())")
  })
})
