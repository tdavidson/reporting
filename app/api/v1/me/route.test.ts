import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FEATURE_VISIBILITY, type FeatureVisibilityMap } from '@/lib/types/features'

/**
 * `/me` is the endpoint the native app trusts to tell it what to render. If it over-reports, the
 * app shows a tab whose API will refuse it; if it leaks, it leaks the fund's whole configuration
 * to a read-only token. Both are answered here rather than by the client.
 */

const mocks = vi.hoisted(() => ({
  resolveV1Principal: vi.fn(),
  member: { data: { display_name: 'Ada' }, error: null } as any,
  fund: { data: { name: 'Hemrock Ventures' }, error: null } as any,
  settings: { data: { default_ai_provider: 'anthropic', claude_api_key_encrypted: 'enc', openai_api_key_encrypted: null }, error: null } as any,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          if (table === 'funds') return mocks.fund
          if (table === 'fund_settings') return mocks.settings
          return mocks.member
        },
      }
      return chain
    },
  }),
}))
vi.mock('@/lib/api-v1/principal', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/api-v1/principal')>()),
  resolveV1Principal: mocks.resolveV1Principal,
}))

import { GET } from './route'
import { V1PrincipalError } from '@/lib/api-v1/principal'

function principal(over: { role?: string; grants?: Record<string, string>; features?: Partial<FeatureVisibilityMap> } = {}) {
  return {
    userId: 'user-1',
    fundId: 'fund-1',
    role: over.role ?? 'member',
    clientId: 'client-1',
    scopes: ['read'],
    access: {
      fundId: 'fund-1',
      userId: 'user-1',
      role: over.role ?? 'member',
      features: { ...DEFAULT_FEATURE_VISIBILITY, ...(over.features ?? {}) } as FeatureVisibilityMap,
      grants: over.grants ?? {},
      defaults: {},
    },
  }
}

const request = () =>
  new Request('https://reporting.test/api/v1/me', { headers: { Authorization: 'Bearer mcp_at_valid' } })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.member = { data: { display_name: 'Ada' }, error: null }
  mocks.fund = { data: { name: 'Hemrock Ventures' }, error: null }
  mocks.settings = { data: { default_ai_provider: 'anthropic', claude_api_key_encrypted: 'enc', openai_api_key_encrypted: null }, error: null }
})

describe('GET /api/v1/me', () => {
  it('returns the principal and its resolved access map, never cached', async () => {
    mocks.resolveV1Principal.mockResolvedValue(principal({ grants: { portfolio: 'read' } }))
    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-request-id')).toBe(body.requestId)
    expect(body).toMatchObject({
      user: { id: 'user-1', displayName: 'Ada' },
      fund: { id: 'fund-1', name: 'Hemrock Ventures' },
      role: 'member',
    })
    expect(body.access.portfolio).toBe('read')
    expect(body.access.accounting).toBe('none')
  })

  it('reflects a permission change on the very next call — the grant is resolved, not cached', async () => {
    mocks.resolveV1Principal.mockResolvedValueOnce(principal({ grants: { accounting: 'write' }, features: { accounting: 'everyone' } }))
    const before = await (await GET(request())).json()
    expect(before.access.accounting).toBe('write')
    expect(before.availableAnalystScopes).toContain('accounting')

    mocks.resolveV1Principal.mockResolvedValueOnce(principal({ grants: {}, features: { accounting: 'everyone' } }))
    const after = await (await GET(request())).json()
    expect(after.access.accounting).toBe('none')
    expect(after.availableAnalystScopes).not.toContain('accounting')
  })

  it('reports a feature the fund has switched off as neither enabled nor a scope, admin or not', async () => {
    mocks.resolveV1Principal.mockResolvedValue(principal({ role: 'admin', features: { accounting: 'off' } }))
    const body = await (await GET(request())).json()
    expect(body.access.accounting).toBe('none')
    expect(body.enabledFeatures).not.toContain('accounting')
    expect(body.availableAnalystScopes).not.toContain('accounting')
  })

  it('discloses no credentials, raw grant rows, or other funds', async () => {
    mocks.resolveV1Principal.mockResolvedValue(principal({ role: 'admin', features: { accounting: 'everyone' } }))
    const raw = JSON.stringify(await (await GET(request())).json())
    expect(raw).not.toMatch(/token|secret|api_key|apiKey|featureVisibility|fund_member_access/i)
  })

  it('names the AI provider without disclosing anything about the key', async () => {
    mocks.resolveV1Principal.mockResolvedValue(principal())
    const body = await (await GET(request())).json()
    expect(body.aiProvider).toEqual({ displayName: 'Anthropic Claude', configured: true })
  })

  it('reports a fund with no provider configured, rather than letting chat fail mysteriously', async () => {
    mocks.resolveV1Principal.mockResolvedValue(principal())
    mocks.settings = { data: { default_ai_provider: 'openai', claude_api_key_encrypted: 'enc', openai_api_key_encrypted: null }, error: null }
    const body = await (await GET(request())).json()
    // The DEFAULT provider is what chat will use, so an OpenAI default with only a Claude key
    // configured is not configured.
    expect(body.aiProvider).toEqual({ displayName: 'OpenAI', configured: false })
  })

  it('reports the credential kind the server resolved', async () => {
    mocks.resolveV1Principal.mockResolvedValue({ ...principal(), credentialKind: 'oauth' })
    const body = await (await GET(request())).json()
    expect(body.credentialKind).toBe('oauth')
    expect(body.isDemo).toBe(false)
  })

  it('marks a demo credential, and says it can neither stage nor approve', async () => {
    mocks.resolveV1Principal.mockResolvedValue({
      ...principal({ grants: { accounting: 'write' }, features: { accounting: 'everyone' } }),
      credentialKind: 'demo',
      scopes: ['read', 'write'],
    })
    const body = await (await GET(request())).json()
    expect(body.credentialKind).toBe('demo')
    expect(body.isDemo).toBe(true)
    // Grants and scope both say write; the credential says no, and the credential wins.
    expect(body.canStageActions).toBe(false)
    expect(body.canApproveActions).toBe(false)
  })

  it('reports a read-only TOKEN as unable to stage, whatever the user’s grants allow', async () => {
    mocks.resolveV1Principal.mockResolvedValue({
      ...principal({ grants: { accounting: 'write' }, features: { accounting: 'everyone' } }),
      scopes: ['read'],
    })
    const body = await (await GET(request())).json()
    expect(body.access.accounting).toBe('write')
    expect(body.canStageActions).toBe(false)
    expect(body.canApproveActions).toBe(false)
  })

  it('reports a write-scoped member with write grants as able to stage and approve', async () => {
    mocks.resolveV1Principal.mockResolvedValue({
      ...principal({ grants: { accounting: 'write' }, features: { accounting: 'everyone' } }),
      scopes: ['read', 'write'],
    })
    const body = await (await GET(request())).json()
    expect(body.canStageActions).toBe(true)
    expect(body.canApproveActions).toBe(true)
  })

  it('reports a member who can write nowhere as unable to approve', async () => {
    mocks.resolveV1Principal.mockResolvedValue({
      ...principal({ grants: { portfolio: 'read' } }),
      scopes: ['read', 'write'],
    })
    const body = await (await GET(request())).json()
    expect(body.canApproveActions).toBe(false)
  })

  it('passes an authentication failure through as the v1 envelope', async () => {
    mocks.resolveV1Principal.mockRejectedValue(
      new V1PrincipalError('A valid OAuth access token is required.', 401, 'INVALID_TOKEN'),
    )
    const response = await GET(request())
    const body = await response.json()
    expect(response.status).toBe(401)
    expect(body.error).toMatchObject({ code: 'INVALID_TOKEN' })
    expect(body.error.requestId).toBe(response.headers.get('x-request-id'))
  })

  it('does not leak an internal failure into the response body', async () => {
    mocks.resolveV1Principal.mockResolvedValue(principal())
    mocks.fund = { data: null, error: { message: 'connection to fund-db refused' } }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await GET(request())
    const body = await response.json()
    expect(response.status).toBe(500)
    expect(JSON.stringify(body)).not.toContain('fund-db')
    consoleError.mockRestore()
  })
})
