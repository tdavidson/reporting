import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * "Pre-filled from your last sent request" spans four files: a column to store the list, an
 * insert that writes it, a select that returns it, and a composer that reads it back. Break any
 * one and the field silently comes back blank — the send still succeeds, so nothing else fails.
 * These assertions pin the chain end to end.
 */

const root = process.cwd()
const read = (...p: string[]) => readFileSync(path.join(root, ...p), 'utf8')

describe('Asks Cc/Bcc round-trip', () => {
  it('stores both lists on email_requests', () => {
    const dir = path.join(root, 'supabase', 'migrations')
    const sql = readdirSync(dir)
      .filter(f => f.endsWith('.sql'))
      .map(f => readFileSync(path.join(dir, f), 'utf8'))
      .join('\n')
      .toLowerCase()

    expect(sql).toMatch(/alter table\s+public\.email_requests[\s\S]{0,200}\bcc\b/)
    expect(sql).toMatch(/alter table\s+public\.email_requests[\s\S]{0,200}\bbcc\b/)
  })

  it('writes them on send', () => {
    const route = read('app', 'api', 'requests', 'send', 'route.ts')
    expect(route).toMatch(/cc:\s*ccList\.value/)
    expect(route).toMatch(/bcc:\s*bccList\.value/)
    // Normalized, not raw: the values reach a MIME header on the Gmail path.
    expect(route).toContain('parseAddressList')
  })

  it('returns them from the requests list', () => {
    const route = read('app', 'api', 'requests', 'route.ts')
    const select = route.match(/\.select\('([^']*email_requests?[^']*|[^']*subject[^']*)'\)/)?.[1] ?? ''
    expect(select).toContain('cc')
    expect(select).toContain('bcc')
  })

  it('restores them into the composer', () => {
    const page = read('app', '(app)', 'requests', 'page.tsx')
    expect(page).toMatch(/setCc\(\(lastSent\.cc/)
    expect(page).toMatch(/setBcc\(\(lastSent\.bcc/)
    // And sends what it restored.
    expect(page).toMatch(/bcc:\s*bcc\.trim\(\)/)
  })
})
