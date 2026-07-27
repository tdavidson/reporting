import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Which paths an anonymous visitor may reach.
 *
 * The list this pins used to be one long `||` chain of marketing paths. When the marketing site
 * collapsed to a single page (ab4d9c6), the chain was rewritten as `pathname === '/'` — which was
 * right for the deleted legal/pricing pages and wrong for `/demo`, a route that still exists and
 * MUST render to a signed-out visitor, because its auto-sign-in runs client-side in the page. A
 * middleware redirect means the page never mounts and the demo silently asks for a login instead.
 */

const getUser = vi.hoisted(() => vi.fn())
const from = vi.hoisted(() => vi.fn())
const rpc = vi.hoisted(() => vi.fn())
const getAuthenticatorAssuranceLevel = vi.hoisted(() => vi.fn(async () => ({ data: null })))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser, mfa: { getAuthenticatorAssuranceLevel } },
    from,
    rpc,
  }),
}))

import { middleware } from '@/middleware'

const req = (pathname: string) =>
  ({
    nextUrl: { pathname, search: '', clone: () => new URL(`https://x${pathname}`) },
    cookies: { getAll: () => [], set: () => {} },
    method: 'GET',
    headers: new Headers(),
  }) as any

/** A redirect to /auth is the signed-out bounce; anything else means the page renders. */
const redirectedToAuth = (res: Response) =>
  res.status === 307 && new URL(res.headers.get('location')!).pathname === '/auth'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_ENABLE_MARKETING_SITE', 'true')
  vi.stubEnv('MARKETING_DEPLOYMENT_KEY', 'deploy-key')
  getUser.mockResolvedValue({ data: { user: null } })
  getAuthenticatorAssuranceLevel.mockResolvedValue({ data: null })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('middleware — anonymous access to the public surfaces', () => {
  it('lets a signed-out visitor reach /demo, so the page can sign itself in', async () => {
    // app/demo/page.tsx calls signInWithPassword in a useEffect. Bounce the request here and that
    // effect never runs — the visitor lands on /auth?next=/demo and has to find credentials they
    // do not have. Every "try the demo" link in the app and the footer points at this path.
    expect(redirectedToAuth(await middleware(req('/demo')))).toBe(false)
  })

  it('lets a signed-out visitor reach the marketing page', async () => {
    expect(redirectedToAuth(await middleware(req('/')))).toBe(false)
  })

  it('bounces a signed-out visitor off an app route', async () => {
    const res = await middleware(req('/dashboard'))
    expect(redirectedToAuth(res)).toBe(true)
    expect(new URL(res.headers.get('location')!).searchParams.get('next')).toBe('/dashboard')
  })

  it('bounces /demo when the marketing site is switched off — there is no demo to load', async () => {
    // getDemoCredentials refuses under the same condition, so an open page would only 500 its way
    // to an error state. Keep the two ends agreeing.
    vi.stubEnv('NEXT_PUBLIC_ENABLE_MARKETING_SITE', 'false')
    expect(redirectedToAuth(await middleware(req('/demo')))).toBe(true)
  })

  it('bounces /demo when the deployment key is missing', async () => {
    vi.stubEnv('MARKETING_DEPLOYMENT_KEY', '')
    expect(redirectedToAuth(await middleware(req('/demo')))).toBe(true)
  })
})
