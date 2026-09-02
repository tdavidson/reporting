import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FEATURE_VISIBILITY } from '@/lib/types/features'

const mocks = vi.hoisted(() => ({
  resolveAccessToken: vi.fn(),
  agentApiEnabled: vi.fn(),
  loadAccessContext: vi.fn(),
}))

vi.mock('@/lib/oauth/store', () => ({ resolveAccessToken: mocks.resolveAccessToken }))
vi.mock('@/lib/oauth/enabled', () => ({ agentApiEnabled: mocks.agentApiEnabled }))
vi.mock('@/lib/access/effective', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/access/effective')>()),
  loadAccessContext: mocks.loadAccessContext,
}))

import { requireV1Write, resolveV1Principal, V1PrincipalError } from './principal'

let membership: { fund_id: string; role: string } | null
const admin: any = {
  from: () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: membership, error: null }) }),
      }),
    }),
  }),
}

function request(token?: string) {
  return new Request('https://reporting.test/api/v1/me', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  membership = { fund_id: 'fund-1', role: 'member' }
  mocks.resolveAccessToken.mockResolvedValue({
    userId: 'user-1', fundId: 'fund-1', clientId: 'client-1', scope: 'read write',
  })
  mocks.agentApiEnabled.mockResolvedValue(true)
  mocks.loadAccessContext.mockResolvedValue({
    fundId: 'fund-1', userId: 'user-1', role: 'member',
    features: DEFAULT_FEATURE_VISIBILITY, grants: {}, defaults: {},
  })
})

describe('resolveV1Principal', () => {
  it.each([undefined, 'lk_static', 'garbage'])('uniformly rejects a non-OAuth bearer token (%s)', async token => {
    await expect(resolveV1Principal(admin, request(token))).rejects.toMatchObject({
      status: 401, code: 'INVALID_TOKEN',
    })
    expect(mocks.resolveAccessToken).not.toHaveBeenCalled()
  })

  it('uniformly rejects an expired, revoked, unknown, or otherwise unresolved OAuth token', async () => {
    mocks.resolveAccessToken.mockResolvedValue(null)
    await expect(resolveV1Principal(admin, request('mcp_at_bad'))).rejects.toMatchObject({
      status: 401, code: 'INVALID_TOKEN',
    })
  })

  it('rejects a token after its owner is removed from the token fund', async () => {
    membership = null
    await expect(resolveV1Principal(admin, request('mcp_at_valid'))).rejects.toMatchObject({
      status: 401, code: 'INVALID_TOKEN',
    })
  })

  it('rechecks the fund kill switch and live access on every request', async () => {
    const first = await resolveV1Principal(admin, request('mcp_at_valid'))
    expect(first.userId).toBe('user-1')
    expect(mocks.loadAccessContext).toHaveBeenCalledWith(admin, 'fund-1', 'user-1', 'member')

    mocks.agentApiEnabled.mockResolvedValue(false)
    await expect(resolveV1Principal(admin, request('mcp_at_valid'))).rejects.toMatchObject({
      status: 403, code: 'EXTERNAL_ACCESS_DISABLED',
    })
    expect(mocks.agentApiEnabled).toHaveBeenCalledTimes(2)
  })

  it('requires OAuth write scope independently of live domain grants', () => {
    expect(() => requireV1Write({ scopes: ['read'] } as any)).toThrow(V1PrincipalError)
    expect(() => requireV1Write({ scopes: ['read', 'write'] } as any)).not.toThrow()
  })
})

