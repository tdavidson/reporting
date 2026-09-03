import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FEATURE_VISIBILITY, type FeatureVisibilityMap } from '@/lib/types/features'

/**
 * The staged-write boundary, from the outside.
 *
 * Two properties matter more than the payload shape. A read-only OAuth token must not be able to
 * approve anything, whatever the user's own grants say — the token is the narrower of the two. And
 * an approval must be safe to retry: the phone cannot tell a lost response from a lost request, so
 * the same Idempotency-Key has to return the same answer rather than a confusing error about an
 * action that is no longer pending.
 */

const mocks = vi.hoisted(() => ({
  resolveV1Principal: vi.fn(),
  listPendingActions: vi.fn(),
  approvePendingAction: vi.fn(),
  rejectPendingAction: vi.fn(),
  revalidateTag: vi.fn(),
  rows: new Map<string, Record<string, any>>(),
}))

vi.mock('next/cache', () => ({ revalidateTag: mocks.revalidateTag }))
vi.mock('@/lib/api-v1/principal', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/api-v1/principal')>()),
  resolveV1Principal: mocks.resolveV1Principal,
}))
vi.mock('@/lib/pending-actions/service', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/pending-actions/service')>()),
  listPendingActions: mocks.listPendingActions,
  approvePendingAction: mocks.approvePendingAction,
  rejectPendingAction: mocks.rejectPendingAction,
}))

// A real-enough idempotency table: the unique primary key is the whole mechanism, so a fake that
// does not enforce it would test nothing.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table !== 'api_idempotency_keys') throw new Error(`Unexpected table ${table}`)
      const keyOf = (m: Record<string, any>) => `${m.fund_id}|${m.client_id}|${m.endpoint}|${m.key}`
      return {
        insert: async (row: Record<string, any>) => {
          const k = keyOf(row)
          if (mocks.rows.has(k)) return { error: { code: '23505', message: 'duplicate key' } }
          mocks.rows.set(k, { ...row })
          return { error: null }
        },
        select: () => ({
          match: (m: Record<string, any>) => ({
            maybeSingle: async () => ({ data: mocks.rows.get(keyOf(m)) ?? null, error: null }),
          }),
        }),
        update: (patch: Record<string, any>) => ({
          match: async (m: Record<string, any>) => {
            const existing = mocks.rows.get(keyOf(m))
            if (existing) mocks.rows.set(keyOf(m), { ...existing, ...patch })
            return { error: null }
          },
        }),
        delete: () => ({
          match: async (m: Record<string, any>) => {
            mocks.rows.delete(keyOf(m))
            return { error: null }
          },
        }),
      }
    },
  }),
}))

import { GET as listRoute } from './route'
import { POST as approveRoute } from './[id]/approve/route'
import { POST as rejectRoute } from './[id]/reject/route'
import { PendingActionServiceError } from '@/lib/pending-actions/service'

function principal(scopes: string[]) {
  return {
    userId: 'user-1',
    fundId: 'fund-1',
    role: 'member',
    clientId: 'client-1',
    scopes,
    access: {
      fundId: 'fund-1',
      userId: 'user-1',
      role: 'member',
      features: { ...DEFAULT_FEATURE_VISIBILITY, accounting: 'everyone' } as FeatureVisibilityMap,
      grants: { accounting: 'write' },
      defaults: {},
    },
  }
}

const applied = {
  ok: true,
  replayed: false,
  result: { updated: true },
  action: { id: 'action-1', status: 'applied', domain: 'accounting' },
}

const post = (key?: string) =>
  new Request('https://reporting.test/api/v1/pending-actions/action-1/approve', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer mcp_at_valid',
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
  })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rows.clear()
  mocks.resolveV1Principal.mockResolvedValue(principal(['read', 'write']))
  mocks.listPendingActions.mockResolvedValue({ pendingActions: [], nextCursor: null })
  mocks.approvePendingAction.mockResolvedValue(applied)
  mocks.rejectPendingAction.mockResolvedValue({ ok: true, replayed: false, action: { id: 'action-1', status: 'rejected' } })
})

describe('GET /api/v1/pending-actions', () => {
  it('lists through the shared service with the server-derived principal', async () => {
    const response = await listRoute(
      new Request('https://reporting.test/api/v1/pending-actions?limit=5', {
        headers: { Authorization: 'Bearer mcp_at_valid' },
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.listPendingActions).toHaveBeenCalledWith(
      expect.anything(),
      principal(['read', 'write']),
      { limit: 5, cursor: null },
    )
  })

  it('rejects a limit outside the range', async () => {
    const response = await listRoute(
      new Request('https://reporting.test/api/v1/pending-actions?limit=0', {
        headers: { Authorization: 'Bearer mcp_at_valid' },
      }),
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('INVALID_LIMIT')
  })
})

describe('POST /api/v1/pending-actions/:id/approve', () => {
  it('requires an Idempotency-Key before it does anything', async () => {
    const response = await approveRoute(post(), { params: Promise.resolve({ id: 'action-1' }) })
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    expect(mocks.approvePendingAction).not.toHaveBeenCalled()
  })

  it('refuses a read-only token however wide the user’s own grants are', async () => {
    mocks.resolveV1Principal.mockResolvedValue(principal(['read']))
    const response = await approveRoute(post('key-1'), { params: Promise.resolve({ id: 'action-1' }) })
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('WRITE_SCOPE_REQUIRED')
    expect(mocks.approvePendingAction).not.toHaveBeenCalled()
    expect(mocks.rows.size).toBe(0)
  })

  it('approves once and replays the stored response on a retry with the same key', async () => {
    const first = await approveRoute(post('key-1'), { params: Promise.resolve({ id: 'action-1' }) })
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ ok: true, action: { status: 'applied' } })

    const retry = await approveRoute(post('key-1'), { params: Promise.resolve({ id: 'action-1' }) })
    expect(retry.status).toBe(200)
    expect(retry.headers.get('idempotent-replay')).toBe('true')
    expect(await retry.json()).toMatchObject({ ok: true, action: { status: 'applied' } })

    // The point of the whole mechanism: the write ran exactly once.
    expect(mocks.approvePendingAction).toHaveBeenCalledTimes(1)
  })

  it('gives the retry a fresh request id while replaying the same body', async () => {
    const first = await (await approveRoute(post('key-1'), { params: Promise.resolve({ id: 'action-1' }) })).json()
    const retry = await (await approveRoute(post('key-1'), { params: Promise.resolve({ id: 'action-1' }) })).json()
    expect(retry.requestId).not.toBe(first.requestId)
    expect(retry.ok).toBe(true)
  })

  it('refuses a key reused for a different action rather than approving it', async () => {
    await approveRoute(post('key-1'), { params: Promise.resolve({ id: 'action-1' }) })
    const other = new Request('https://reporting.test/api/v1/pending-actions/action-2/approve', {
      method: 'POST',
      headers: { Authorization: 'Bearer mcp_at_valid', 'Idempotency-Key': 'key-1' },
    })
    const response = await approveRoute(other, { params: Promise.resolve({ id: 'action-2' }) })
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(mocks.approvePendingAction).toHaveBeenCalledTimes(1)
  })

  it('frees the key when the approval failed, so the client can genuinely retry', async () => {
    mocks.approvePendingAction.mockRejectedValueOnce(
      new PendingActionServiceError('Action execution failed.', 422, 'ACTION_FAILED'),
    )
    const failed = await approveRoute(post('key-1'), { params: Promise.resolve({ id: 'action-1' }) })
    expect(failed.status).toBe(422)
    expect(mocks.rows.size).toBe(0)

    const retry = await approveRoute(post('key-1'), { params: Promise.resolve({ id: 'action-1' }) })
    expect(retry.status).toBe(200)
    expect(mocks.approvePendingAction).toHaveBeenCalledTimes(2)
  })

  it('passes the service’s own 404 through as the v1 envelope', async () => {
    mocks.approvePendingAction.mockRejectedValue(
      new PendingActionServiceError('Pending action not found.', 404, 'NOT_FOUND'),
    )
    const response = await approveRoute(post('key-1'), { params: Promise.resolve({ id: 'action-1' }) })
    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })
})

describe('POST /api/v1/pending-actions/:id/reject', () => {
  it('also requires a write-scoped token', async () => {
    mocks.resolveV1Principal.mockResolvedValue(principal(['read']))
    const response = await rejectRoute(post('key-1'), { params: Promise.resolve({ id: 'action-1' }) })
    expect(response.status).toBe(403)
    expect(mocks.rejectPendingAction).not.toHaveBeenCalled()
  })

  it('rejects through the shared service and refreshes the badge', async () => {
    const response = await rejectRoute(post(), { params: Promise.resolve({ id: 'action-1' }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, action: { status: 'rejected' } })
    // Immediate expiry, not stale-while-revalidate — see lib/cache/tags.ts for why.
    expect(mocks.revalidateTag).toHaveBeenCalledWith('pending-actions-badge', { expire: 0 })
  })
})
