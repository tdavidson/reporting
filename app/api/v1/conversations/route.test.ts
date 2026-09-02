import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FEATURE_VISIBILITY, type FeatureVisibilityMap } from '@/lib/types/features'

/**
 * The conversation wrappers are thin, and the thing worth testing about them is exactly what a thin
 * wrapper can still get wrong: whether the caller can widen what it sees. Every query is scoped to
 * the token's user AND fund in lib/api-v1/conversations.ts; these tests hold the routes to passing
 * the server-derived principal through unchanged, and to answering 404 rather than 403 for a
 * conversation belonging to someone else — a 403 would confirm it exists.
 */

const mocks = vi.hoisted(() => ({
  resolveV1Principal: vi.fn(),
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  deleteConversation: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ tag: 'admin' }) }))
vi.mock('@/lib/api-v1/principal', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/api-v1/principal')>()),
  resolveV1Principal: mocks.resolveV1Principal,
}))
vi.mock('@/lib/api-v1/conversations', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/api-v1/conversations')>()),
  listConversations: mocks.listConversations,
  getConversation: mocks.getConversation,
  deleteConversation: mocks.deleteConversation,
}))

import { GET as list } from './route'
import { GET as detail, DELETE as remove } from '../conversations/[id]/route'
import { V1PrincipalError } from '@/lib/api-v1/principal'

const principal = {
  userId: 'user-1',
  fundId: 'fund-1',
  role: 'member',
  clientId: 'client-1',
  scopes: ['read'],
  access: {
    fundId: 'fund-1',
    userId: 'user-1',
    role: 'member',
    features: { ...DEFAULT_FEATURE_VISIBILITY } as FeatureVisibilityMap,
    grants: {},
    defaults: {},
  },
}

const get = (query = '') =>
  new Request(`https://reporting.test/api/v1/conversations${query}`, {
    headers: { Authorization: 'Bearer mcp_at_valid' },
  })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveV1Principal.mockResolvedValue(principal)
  mocks.listConversations.mockResolvedValue({ conversations: [], nextCursor: null })
})

describe('GET /api/v1/conversations', () => {
  it('scopes the listing to the token’s principal and never caches it', async () => {
    const response = await list(get())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.listConversations).toHaveBeenCalledWith({ tag: 'admin' }, principal, {
      limit: 20,
      cursor: null,
    })
  })

  it('passes an explicit limit and cursor through', async () => {
    await list(get('?limit=5&cursor=abc'))
    expect(mocks.listConversations).toHaveBeenCalledWith({ tag: 'admin' }, principal, {
      limit: 5,
      cursor: 'abc',
    })
  })

  it('rejects a limit outside the allowed range instead of clamping it silently', async () => {
    const response = await list(get('?limit=5000'))
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.error.code).toBe('INVALID_LIMIT')
    expect(mocks.listConversations).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric limit', async () => {
    const response = await list(get('?limit=all'))
    expect((await response.json()).error.code).toBe('INVALID_LIMIT')
  })

  it('surfaces a bad cursor as INVALID_CURSOR rather than a 500', async () => {
    const { ConversationRequestError } = await import('@/lib/api-v1/conversations')
    mocks.listConversations.mockRejectedValue(
      new ConversationRequestError('The conversation cursor is invalid.', 400, 'INVALID_CURSOR'),
    )
    const response = await list(get('?cursor=nonsense'))
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('INVALID_CURSOR')
  })

  it('requires a token', async () => {
    mocks.resolveV1Principal.mockRejectedValue(
      new V1PrincipalError('A valid OAuth access token is required.', 401, 'INVALID_TOKEN'),
    )
    const response = await list(get())
    expect(response.status).toBe(401)
  })
})

describe('GET /api/v1/conversations/:id', () => {
  it('returns the full conversation for its owner', async () => {
    mocks.getConversation.mockResolvedValue({ id: 'c1', messages: [{ role: 'user', content: 'Hi' }] })
    const response = await detail(get('/c1'), { params: { id: 'c1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.conversation.messages).toHaveLength(1)
    expect(mocks.getConversation).toHaveBeenCalledWith({ tag: 'admin' }, principal, 'c1')
  })

  it('answers 404 for another user’s conversation — a 403 would confirm it exists', async () => {
    mocks.getConversation.mockResolvedValue(null)
    const response = await detail(get('/someone-elses'), { params: { id: 'someone-elses' } })
    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })
})

describe('DELETE /api/v1/conversations/:id', () => {
  it('deletes only through the principal-scoped helper', async () => {
    mocks.deleteConversation.mockResolvedValue(true)
    const response = await remove(get('/c1'), { params: { id: 'c1' } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
    expect(mocks.deleteConversation).toHaveBeenCalledWith({ tag: 'admin' }, principal, 'c1')
  })

  it('reports a conversation it did not own as not found, having deleted nothing', async () => {
    mocks.deleteConversation.mockResolvedValue(false)
    const response = await remove(get('/c9'), { params: { id: 'c9' } })
    expect(response.status).toBe(404)
  })
})
