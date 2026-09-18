import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

// reminder_deliveries is read and written only by the ops-reminders cron with the service-role
// key. A Data API grant to authenticated would expose which reminders a fund has been sent to
// any browser holding the anon key — and nothing in the app needs it. Same shape as
// tax-data-api-grants.test.ts.

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const sql = readdirSync(MIGRATIONS)
  .filter(f => f.endsWith('.sql'))
  .map(f => readFileSync(join(MIGRATIONS, f), 'utf8'))
  .join('\n')

describe('reminder_deliveries is service-role only', () => {
  it('is created', () => {
    expect(sql).toMatch(/create table public\.reminder_deliveries/i)
  })

  it('revokes the default grants from anon and authenticated', () => {
    expect(sql).toMatch(/revoke all on public\.reminder_deliveries from anon, authenticated;/i)
  })

  it('grants only service_role', () => {
    const grants = [...sql.matchAll(/\bgrant\s+[^;]*?\bon\s+(?:table\s+)?public\.reminder_deliveries\s+to\s+([^;]+);/gi)]
    expect(grants.length).toBeGreaterThan(0)
    for (const g of grants) expect(g[1].trim().toLowerCase()).toBe('service_role')
  })

  it('has no policy for authenticated or anon', () => {
    expect(sql).not.toMatch(/create policy[^;]*on public\.reminder_deliveries[^;]*to (authenticated|anon)/i)
  })
})
