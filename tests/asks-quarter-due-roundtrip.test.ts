import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// The follow-up reminder keys off email_requests.quarter/year/due_date. The composer sends them,
// the route validates and stores them — break either link and reminders silently never fire.
const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), 'utf8')

describe('Asks quarter + due date round-trip', () => {
  it('the send route stores quarter, year and due_date', () => {
    const route = read('app', 'api', 'requests', 'send', 'route.ts')
    expect(route).toMatch(/quarter:\s*period\?\.quarter/)
    expect(route).toMatch(/year:\s*period\?\.year/)
    expect(route).toMatch(/due_date:\s*dueDate/)
  })

  it('the send route validates the date by round-trip and reports a failed record instead of dropping it', () => {
    const route = read('app', 'api', 'requests', 'send', 'route.ts')
    expect(route).toMatch(/const dueDate = parseDueDate\(due_date\)/)
    expect(route).toMatch(/const \{ error: recordError \} = await admin\.from\('email_requests'\)\.insert/)
    expect(route).toMatch(/recordError \? \{ warning:/)
    const page = read('app', '(app)', 'requests', 'page.tsx')
    expect(page).toMatch(/warning: data\.warning/)
    expect(page).toMatch(/results\.warning &&/)
  })

  it('the composer sends them on a real send but not on a test send', () => {
    const page = read('app', '(app)', 'requests', 'page.tsx')
    const handleSend = page.slice(page.indexOf('const handleSend'))
    expect(handleSend).toMatch(/due_date:\s*dueDate/)
    expect(handleSend).toMatch(/quarter:\s*period\.quarter/)
    const handleTest = page.slice(page.indexOf('const handleTestSend'), page.indexOf('const handleSend'))
    expect(handleTest).not.toMatch(/due_date/)
  })

  it('the quarter backfill cannot abort on a non-array recipients value', () => {
    const migration = read('supabase', 'migrations', '20260918000002_email_requests_quarter_due.sql')
    expect(migration).toMatch(/case when jsonb_typeof\(recipients\) = 'array'\s+then jsonb_array_length\(recipients\)/)
    expect(migration).not.toMatch(/not \(jsonb_array_length/)
  })
})
