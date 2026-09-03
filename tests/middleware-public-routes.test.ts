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
// Typed to what Supabase actually returns, not to the null the default case happens
// to use — the MFA cases below need to hand it a real assurance level.
type AalResult = { data: { nextLevel: string; currentLevel: string } | null }
const getAuthenticatorAssuranceLevel = vi.hoisted(() =>
  vi.fn<() => Promise<AalResult>>(async () => ({ data: null }))
)

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

/**
 * The installable-app shell.
 *
 * These are not fetched by a person following a link, so a redirect does not
 * land anyone on a login page — it fails the install with an opaque error. A browser
 * requests a manifest WITHOUT credentials unless it is marked use-credentials, and
 * /sw.js is fetched by the worker registration, which refuses an HTML response on
 * MIME type and reports only that registration failed.
 */
const PWA_SHELL = ['/manifest.webmanifest', '/portal/manifest.webmanifest', '/sw.js', '/offline']

describe('middleware — the PWA shell answers without a session', () => {
  for (const path of PWA_SHELL) {
    it(`serves ${path} to a signed-out visitor`, async () => {
      expect(redirectedToAuth(await middleware(req(path)))).toBe(false)
    })
  }

  it('serves them to a user who has not yet cleared MFA', async () => {
    // The AAL2 gate redirects to /auth/mfa-verify, which for /sw.js means HTML where
    // JavaScript was asked for. Nothing in the shell is what AAL2 protects.
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { nextLevel: 'aal2', currentLevel: 'aal1' },
    })

    for (const path of PWA_SHELL) {
      const res = await middleware(req(path))
      expect(res.status, path).not.toBe(307)
    }
  })

  it('does not route the shell through LP/GP separation', async () => {
    // An LP-only user asking for /sw.js was redirected to /portal/overview, and a
    // worker handed HTML fails registration on MIME type — so the LP portal would
    // never have installed. The shell is the same bytes for everyone; there is no
    // identity question to ask about it.
    getUser.mockResolvedValue({ data: { user: { id: 'lp1' } } })
    from.mockImplementation((table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === 'lp_accounts' ? { data: { status: 'active' } } : { data: null },
        }),
      }),
    }))

    for (const path of PWA_SHELL) {
      const res = await middleware(req(path))
      expect(res.status, path).not.toBe(307)
    }
    // The same user on a GP route still gets sent to their portal.
    const res = await middleware(req('/dashboard'))
    expect(new URL(res.headers.get('location')!).pathname).toBe('/portal/overview')
  })

  it('does not exempt the rest of /portal', async () => {
    // The portal manifest is an exact path, not a /portal prefix. If it were a
    // prefix, every portal page would answer to anyone.
    expect(redirectedToAuth(await middleware(req('/portal/overview')))).toBe(true)
    expect(redirectedToAuth(await middleware(req('/portal/manifest.webmanifest/x')))).toBe(true)
  })

  it('still gates a real app route for that same user', async () => {
    // Guards the exemption above from having widened past the shell itself.
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { nextLevel: 'aal2', currentLevel: 'aal1' },
    })

    const res = await middleware(req('/dashboard'))
    expect(new URL(res.headers.get('location')!).pathname).toBe('/auth/mfa-verify')
  })
})

/**
 * Where a signed-in member of the fund actually begins.
 *
 * `/` is the post-login destination — both auth callbacks default `next` to it — and it renders
 * the marketing page. That was right when the only signed-in entry point was a nav click, and
 * wrong once /start existed: a GP with a session has no use for the pricing tiers, and with the
 * marketing site switched off the page redirects to /auth, which is a signed-in user being sent
 * to a login form.
 *
 * The redirect lives here rather than in the auth routes because those are not the only way in:
 * a bookmark, the PWA start_url and the browser's own address bar all arrive at `/` with a
 * session already set.
 */
describe('middleware — a signed-in GP lands on /start', () => {
  /** fund_members answers `member`, lp_accounts answers `lp`; anything else is empty. */
  const identity = (member: boolean, lp: string | null) =>
    from.mockImplementation((table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === 'fund_members') return { data: member ? { fund_id: 'f1' } : null }
            if (table === 'lp_accounts') return { data: lp ? { status: lp } : null }
            return { data: null }
          },
        }),
      }),
    }))

  const location = (res: Response) => new URL(res.headers.get('location')!).pathname

  it('sends a GP asking for / to /start', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'gp1' } } })
    identity(true, null)
    const res = await middleware(req('/'))
    expect(res.status).toBe(307)
    expect(location(res)).toBe('/start')
  })

  it('still serves the marketing page to a signed-out visitor', async () => {
    // The whole point of the redirect is that it keys on the session, not on the route.
    const res = await middleware(req('/'))
    expect(res.status).not.toBe(307)
  })

  it('redirects a GP even when the marketing site is switched off', async () => {
    // Without this the (public) page finds no site_content and redirects to /auth — a signed-in
    // user sent to a login form.
    vi.stubEnv('NEXT_PUBLIC_ENABLE_MARKETING_SITE', 'false')
    getUser.mockResolvedValue({ data: { user: { id: 'gp1' } } })
    identity(true, null)
    expect(location(await middleware(req('/')))).toBe('/start')
  })

  it('does not redirect /start itself', async () => {
    // A landing page that bounces to itself is an infinite loop, not a landing page.
    getUser.mockResolvedValue({ data: { user: { id: 'gp1' } } })
    identity(true, null)
    const res = await middleware(req('/start'))
    expect(res.status).not.toBe(307)
  })

  it('leaves an LP-only user on the marketing page', async () => {
    // LPs are not members of the fund and /start is a GP surface. Their own routing is the
    // LP/GP split, which owns /portal — this block must not reach past GPs.
    getUser.mockResolvedValue({ data: { user: { id: 'lp1' } } })
    identity(false, 'active')
    const res = await middleware(req('/'))
    expect(res.status).not.toBe(307)
  })

  it('sends a GP bounced off the portal to /start, not through / a second time', async () => {
    // The portal split used to fall back to '/', which now redirects again. One hop, not two.
    getUser.mockResolvedValue({ data: { user: { id: 'gp1' } } })
    identity(true, null)
    expect(location(await middleware(req('/portal/overview')))).toBe('/start')
  })
})
