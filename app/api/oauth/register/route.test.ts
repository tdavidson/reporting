import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Phase 4.5 item 1: an iOS app — official or forked — must be able to register as an OAuth client.
 * Until this change the validator accepted only `https:` and loopback `http:`, so
 * `ASWebAuthenticationSession`'s custom-scheme callback was refused and no native client could
 * exist at all.
 *
 * The registration endpoint is unauthenticated by necessity (RFC 7591), so these tests care as much
 * about what it still refuses as about what it now accepts.
 */

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  registered: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/rate-limit', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit: mocks.rateLimit,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/oauth/store', () => ({
  registerClient: async (_admin: unknown, params: Record<string, unknown>) => {
    mocks.registered.push(params)
    return {
      client_id: 'mcp_test',
      client_name: params.clientName ?? null,
      redirect_uris: params.redirectUris,
      token_endpoint_auth_method: params.tokenEndpointAuthMethod,
    }
  },
}))

import { POST } from './route'

const register = (body: unknown) =>
  POST(
    new Request('https://reporting.test/api/oauth/register', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }) as any,
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocks.registered = []
  mocks.rateLimit.mockResolvedValue(null)
})

describe('POST /api/oauth/register', () => {
  it('registers the official app’s native callback as a public PKCE client', async () => {
    const response = await register({
      client_name: 'Hemrock Reporting',
      redirect_uris: ['com.hemrock.reporting://oauth'],
    })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.redirect_uris).toEqual(['com.hemrock.reporting://oauth'])
    expect(body.token_endpoint_auth_method).toBe('none')
    expect(body.client_secret).toBeUndefined()
  })

  it('registers a FORK’s own scheme with no source change', async () => {
    const response = await register({
      client_name: 'Acme Capital Reporting',
      redirect_uris: ['io.acmecapital.reporting://oauth'],
    })
    expect(response.status).toBe(201)
    expect((await response.json()).redirect_uris).toEqual(['io.acmecapital.reporting://oauth'])
  })

  it('still registers the web and loopback callbacks it always did', async () => {
    expect((await register({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] })).status).toBe(201)
    expect((await register({ redirect_uris: ['http://127.0.0.1:1455/cb'] })).status).toBe(201)
  })

  it('stores the URI verbatim, because /authorize exact-matches it', async () => {
    await register({ redirect_uris: ['com.hemrock.reporting://oauth'] })
    expect(mocks.registered[0].redirectUris).toEqual(['com.hemrock.reporting://oauth'])
  })

  it.each([
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:text/html,<script>alert(1)</script>'],
    ['file', 'file:///etc/passwd'],
    ['a bare custom scheme', 'myapp://callback'],
    ['remote plain http', 'http://app.example.com/cb'],
    ['a fragment', 'https://app.example.com/cb#x'],
    ['userinfo', 'https://real.example.com@evil.example.com/cb'],
  ])('refuses %s', async (_label, uri) => {
    const response = await register({ redirect_uris: [uri] })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('invalid_redirect_uri')
    expect(mocks.registered).toHaveLength(0)
  })

  it('refuses the whole registration when ONE uri in the list is bad', async () => {
    const response = await register({
      redirect_uris: ['com.hemrock.reporting://oauth', 'javascript:alert(1)'],
    })
    expect(response.status).toBe(400)
    expect(mocks.registered).toHaveLength(0)
  })

  it('still rate-limits, since anyone on the internet can call this', async () => {
    mocks.rateLimit.mockResolvedValue(
      new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
    )
    expect((await register({ redirect_uris: ['https://app.example.com/cb'] })).status).toBe(429)
    expect(mocks.registered).toHaveLength(0)
  })
})
