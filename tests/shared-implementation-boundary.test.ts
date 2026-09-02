import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * "One orchestration service; route handlers authenticate and translate HTTP only."
 *
 * That is the architectural rule the whole plan rests on, and it is the kind of rule that decays
 * silently: the second implementation is always easier to write than the shared one is to find. So
 * it is asserted rather than reviewed. The failure this prevents is not stylistic — the construction
 * model is read by four different surfaces, and a copy that drifts is a number on a phone that
 * disagrees with the same number on the web.
 */

const ROOT = process.cwd()
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${entry}`
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out)
    else if (entry.endsWith('.ts') && !entry.includes('.test.')) out.push(rel)
  }
  return out
}

describe('the portfolio-construction model has one implementation', () => {
  // The REST route the web app calls, the staged write a human approves, the agent/MCP read tool,
  // and the Analyst's presentation block. Every one of them a different transport; all one service.
  const consumers = [
    'app/api/accounting/construction/route.ts',
    'lib/pending-actions/construction.ts',
    'lib/agent/construction-tools.ts',
    'lib/ai/analyst/response.ts',
  ]

  it.each(consumers)('%s goes through lib/accounting/construction-service', file => {
    expect(read(file)).toContain('@/lib/accounting/construction-service')
  })

  it('is loaded and persisted nowhere else', () => {
    // The service owns the table. Anything else touching it directly is the second implementation
    // this test exists to catch.
    const offenders = [...walk('app'), ...walk('lib')]
      .filter(f => f !== 'lib/accounting/construction-service.ts')
      .filter(f => read(f).includes("'fund_construction_models'"))
    expect(offenders, `These reach past the construction service:\n${offenders.join('\n')}`).toEqual([])
  })
})

describe('the /api/v1 boundary translates HTTP and nothing more', () => {
  const v1Routes = walk('app/api/v1')

  it('takes its identity only from the OAuth token, never from a cookie session', () => {
    // A v1 route that fell back to `auth.getUser()` would authenticate a browser against the
    // native boundary — the exact retrofit the plan says not to do. (Reading `fund_members` with
    // the ALREADY-resolved principal is fine, and /me does it for the display name.)
    for (const file of v1Routes) {
      const source = read(file)
      expect(source, `${file} reads a cookie session`).not.toContain('auth.getUser')
      expect(source, `${file} imports the user-context client`).not.toContain('@/lib/supabase/server')
    }
  })

  it('never trusts a fund or user id from the request body', () => {
    for (const file of v1Routes) {
      const source = read(file)
      expect(source, `${file} reads fundId from the request`).not.toMatch(/body\.fundId|body\.userId/)
    }
  })

  it('answers with the shared envelope, never a bare NextResponse.json', () => {
    for (const file of v1Routes) {
      const source = read(file)
      expect(source, `${file} bypasses the v1 response envelope`).not.toContain('NextResponse.json')
    }
  })

  it('decides pending actions only through the shared pending-action service', () => {
    for (const file of v1Routes) {
      const source = read(file)
      if (!file.includes('pending-actions')) continue
      expect(source).toContain('@/lib/pending-actions/service')
      expect(source, `${file} touches pending_actions directly`).not.toContain("'pending_actions'")
    }
  })
})
