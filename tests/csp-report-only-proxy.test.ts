import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The proxy's half of the report-only CSP: a fresh nonce on every page response, set on the
 * REQUEST (so Next nonces its own bootstrap and the layouts can read it) and on the RESPONSE (so
 * the browser evaluates it). Never on an API response, which carries no scripts.
 *
 * The enforcing policy from next.config.mjs is not touched here and is not tested here — it
 * applies as before, beside this one.
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

import { proxy } from '@/proxy'
import { NONCE_HEADER, REPORT_ONLY_HEADER } from '@/lib/security/csp'

const req = (pathname: string) =>
  ({
    nextUrl: { pathname, search: '', clone: () => new URL(`https://x${pathname}`) },
    cookies: { getAll: () => [], set: () => {} },
    method: 'GET',
    headers: new Headers({ host: 'x' }),
  }) as any

const nonceIn = (csp: string) => /'nonce-([^']+)'/.exec(csp)?.[1]

beforeEach(() => {
  vi.clearAllMocks()
  // Signed out on a public page: the proxy forwards rather than redirects.
  getUser.mockResolvedValue({ data: { user: null } })
  process.env.NEXT_PUBLIC_MARKETING_SITE = 'true'
  process.env.MARKETING_SITE = 'true'
})

describe('report-only CSP on page responses', () => {
  it('sets the header with a nonce on a page response', async () => {
    const res = await proxy(req('/auth'))
    const csp = res.headers.get(REPORT_ONLY_HEADER)
    expect(csp).toBeTruthy()
    expect(nonceIn(csp!)).toBeTruthy()
    expect(csp).toContain("'strict-dynamic'")
    expect(csp).not.toContain("'unsafe-inline' 'nonce")
  })

  it('forwards the SAME nonce to the app in the request headers', async () => {
    const res = await proxy(req('/auth'))
    const responseNonce = nonceIn(res.headers.get(REPORT_ONLY_HEADER)!)
    // NextResponse.next({ request: { headers } }) records the overridden request headers under
    // `x-middleware-request-*` for the app to receive; that is where the nonce must be.
    expect(res.headers.get(`x-middleware-request-${NONCE_HEADER}`)).toBe(responseNonce)
    expect(res.headers.get(`x-middleware-request-${REPORT_ONLY_HEADER.toLowerCase()}`)).toContain(`'nonce-${responseNonce}'`)
  })

  it('mints a different nonce for every response', async () => {
    const a = nonceIn((await proxy(req('/auth'))).headers.get(REPORT_ONLY_HEADER)!)
    const b = nonceIn((await proxy(req('/auth'))).headers.get(REPORT_ONLY_HEADER)!)
    expect(a).not.toBe(b)
  })

  it('does not set it on an API response', async () => {
    const res = await proxy(req('/api/v1/meta'))
    expect(res.headers.get(REPORT_ONLY_HEADER)).toBeNull()
    expect(res.headers.get(`x-middleware-request-${NONCE_HEADER}`)).toBeNull()
  })

  it('discards a client-sent Content-Security-Policy request header, so the nonce is always ours', async () => {
    // Next reads the nonce from the enforcing header before the report-only one. A caller who
    // could smuggle one in would pick the nonce the app renders with.
    const r = req('/auth')
    r.headers.set('content-security-policy', "script-src 'nonce-ATTACKER'")
    const res = await proxy(r)
    const ours = nonceIn(res.headers.get(REPORT_ONLY_HEADER)!)
    expect(ours).not.toBe('ATTACKER')
    expect(nonceIn(res.headers.get('x-middleware-request-content-security-policy')!)).toBe(ours)
  })

  it('hands Next the policy under the header name it reads first (request only, never the response)', async () => {
    // Vercel did not forward `content-security-policy-report-only` as a request header, so Next
    // rendered every script un-nonced in production while the layout's x-nonce arrived fine.
    // `content-security-policy` on the REQUEST is the pattern Next's own CSP guide uses; the
    // browser never sees request headers, so this enforces nothing.
    const res = await proxy(req('/auth'))
    const ours = nonceIn(res.headers.get(REPORT_ONLY_HEADER)!)
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(res.headers.get(REPORT_ONLY_HEADER))
    expect(nonceIn(res.headers.get('x-middleware-request-content-security-policy')!)).toBe(ours)
    expect(res.headers.get('content-security-policy')).toBeNull()
  })

  it('does not put unsafe-eval in the production policy', async () => {
    const res = await proxy(req('/auth'))
    expect(res.headers.get(REPORT_ONLY_HEADER)).not.toContain('unsafe-eval')
  })
})
