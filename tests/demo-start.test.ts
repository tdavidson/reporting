import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The demo entry point.
 *
 * What this pins, above everything else: `startDemo()` never returns a credential. The action it
 * replaces handed `DEMO_USER_EMAIL` + `DEMO_USER_PASSWORD` to any anonymous caller and let the
 * browser sign itself in — so the demo password was published to every visitor by design. The
 * session is now minted server-side and the client receives nothing but `{ ok: true }`.
 *
 * Second: the demo is read-only because the account is a `viewer`, and nothing in this repo sets
 * that role — it is a row in someone's database. So the action checks it on every visit rather
 * than trusting it, and refuses to leave a session behind if it ever changes.
 */

const signInWithPassword = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn(async () => ({ error: null })))
const adminFrom = vi.hoisted(() => vi.fn())
const rateLimit = vi.hoisted(() => vi.fn() as any)
const checkBotId = vi.hoisted(() => vi.fn() as any)
const headersMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { signInWithPassword, signOut } }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: adminFrom }),
}))
// Only `rateLimit` is stubbed — `getClientIpFromHeaders` stays real, so the test exercises the
// actual header lookup and the actual key the limiter would be handed.
vi.mock('@/lib/rate-limit', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit,
}))
vi.mock('botid/server', () => ({ checkBotId }))
vi.mock('next/headers', () => ({ headers: headersMock }))

import { startDemo } from '@/app/demo/actions'

/** Rows captured by the demo_sessions insert, so tests can assert on what was logged. */
let logged: Record<string, unknown>[] = []
/** The role the demo account's fund_members row reports. */
let demoRole: string | null = 'viewer'

function stubAdmin() {
  adminFrom.mockImplementation((table: string) => {
    if (table === 'demo_sessions') {
      return {
        insert: async (row: Record<string, unknown>) => {
          logged.push(row)
          return { error: null }
        },
      }
    }
    // fund_members
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({
        data: demoRole ? { role: demoRole } : null,
        error: null,
      }),
    }
    return chain
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  logged = []
  demoRole = 'viewer'
  vi.stubEnv('NEXT_PUBLIC_ENABLE_MARKETING_SITE', 'true')
  vi.stubEnv('MARKETING_DEPLOYMENT_KEY', 'deploy-key')
  vi.stubEnv('DEMO_USER_EMAIL', 'demo@example.com')
  vi.stubEnv('DEMO_USER_PASSWORD', 'demo-password')
  signInWithPassword.mockResolvedValue({ data: { user: { id: 'demo-user' } }, error: null })
  signOut.mockResolvedValue({ error: null })
  rateLimit.mockResolvedValue(null)
  checkBotId.mockResolvedValue({ isBot: false })
  headersMock.mockReturnValue(
    new Headers({ 'x-real-ip': '203.0.113.7', referer: 'https://news.ycombinator.com/', 'x-vercel-ip-country': 'US' })
  )
  stubAdmin()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('startDemo — minting', () => {
  it('signs the visitor in server-side and reports success', async () => {
    const result = await startDemo()
    expect(result.ok).toBe(true)
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'demo@example.com',
      password: 'demo-password',
    })
  })

  it('NEVER returns a credential to the caller', async () => {
    // The regression that started this: the previous action returned { email, password } and the
    // browser signed itself in, publishing the demo password to everyone who loaded the page.
    const result = await startDemo()
    expect(JSON.stringify(result)).not.toContain('demo-password')
    expect(JSON.stringify(result)).not.toContain('demo@example.com')
    expect(Object.keys(result)).not.toContain('password')
    expect(Object.keys(result)).not.toContain('email')
  })

  it('refuses when the demo account is not a viewer, and leaves no session behind', async () => {
    // If someone promotes the demo account, the demo must break loudly rather than quietly
    // becoming writable.
    demoRole = 'admin'
    const result = await startDemo()
    expect(result.ok).toBe(false)
    expect(signOut).toHaveBeenCalled()
  })

  it('refuses when the demo account has no membership at all', async () => {
    demoRole = null
    expect((await startDemo()).ok).toBe(false)
    expect(signOut).toHaveBeenCalled()
  })

  it('refuses when Supabase rejects the sign-in', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'bad password' } })
    const result = await startDemo()
    expect(result.ok).toBe(false)
    // The visitor must not be shown Supabase's internal message.
    expect(JSON.stringify(result)).not.toContain('bad password')
  })
})

describe('startDemo — refusals before any sign-in', () => {
  it('refuses when the marketing site is switched off', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_MARKETING_SITE', 'false')
    expect((await startDemo()).ok).toBe(false)
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('refuses when the demo credentials are not configured', async () => {
    vi.stubEnv('DEMO_USER_PASSWORD', '')
    expect((await startDemo()).ok).toBe(false)
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('refuses when rate limited', async () => {
    rateLimit.mockResolvedValue({ status: 429 })
    expect((await startDemo()).ok).toBe(false)
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('never puts a raw IP in the rate-limit key', async () => {
    // rateLimit persists its key through the rate_limit_check RPC, so a raw key writes the
    // visitor's address into the database for the window.
    await startDemo()
    const { key } = rateLimit.mock.calls[0][0] as { key: string }
    expect(key).not.toContain('203.0.113.7')
  })

  it('refuses a caller BotId identifies as a bot', async () => {
    checkBotId.mockResolvedValue({ isBot: true })
    expect((await startDemo()).ok).toBe(false)
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('still works where BotId is unavailable — self-hosters are not on Vercel', async () => {
    // BotId is defence in depth. The rate limit is the guarantee, and it runs everywhere.
    checkBotId.mockRejectedValue(new Error('botid unavailable'))
    expect((await startDemo()).ok).toBe(true)
    expect(rateLimit).toHaveBeenCalled()
  })
})

describe('startDemo — tracking', () => {
  it('records one demo start, with nothing personal in it', async () => {
    await startDemo()
    expect(logged).toHaveLength(1)
    // Normalised to an origin — URL.origin carries no trailing slash.
    expect(logged[0]).toMatchObject({ referrer: 'https://news.ycombinator.com', country: 'US' })
    const keys = Object.keys(logged[0])
    expect(keys).not.toContain('ip')
    expect(keys).not.toContain('ip_hash')
    expect(keys).not.toContain('user_agent')
  })

  it('stores only the origin of a referrer, never a path a caller supplied', async () => {
    // Referrer-Policy constrains honest browsers. A script can send any Referer header it likes,
    // including one carrying a path, a query string, or markup — so the "origin only" property
    // has to be enforced here rather than assumed from the policy.
    headersMock.mockReturnValue(
      new Headers({ 'x-real-ip': '203.0.113.7', referer: 'https://evil.test/a/path?token=secret' })
    )
    await startDemo()
    expect(logged[0].referrer).toBe('https://evil.test')
  })

  it('drops a referrer that is not a URL', async () => {
    headersMock.mockReturnValue(
      new Headers({ 'x-real-ip': '203.0.113.7', referer: '<script>alert(1)</script>' })
    )
    await startDemo()
    expect(logged[0].referrer).toBeNull()
  })

  it('drops a country that is not a country code', async () => {
    headersMock.mockReturnValue(
      new Headers({ 'x-real-ip': '203.0.113.7', 'x-vercel-ip-country': 'not-a-country' })
    )
    await startDemo()
    expect(logged[0].country).toBeNull()
  })

  it('still lets the visitor in when logging fails', async () => {
    adminFrom.mockImplementation((table: string) => {
      if (table === 'demo_sessions') {
        return { insert: async () => ({ error: { message: 'table missing' } }) }
      }
      const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { role: 'viewer' }, error: null }) }
      return chain
    })
    expect((await startDemo()).ok).toBe(true)
  })
})
