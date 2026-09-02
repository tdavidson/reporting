import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_FEATURE_VISIBILITY, type FeatureVisibilityMap } from '@/lib/types/features'
import type { V1Principal } from './principal'
import {
  claimIdempotentRequest,
  completeIdempotentRequest,
  idempotencyKeyFrom,
  releaseIdempotentRequest,
  requestFingerprint,
} from './idempotency'

/**
 * The header was required and then ignored, so a retry of a SUCCESSFUL approval came back as an
 * error about an action that was no longer pending — leaving the client to guess whether it had
 * moved money. These tests are about the three answers a second request can get.
 */

const principal: V1Principal = {
  userId: 'user-1',
  fundId: 'fund-1',
  role: 'member',
  clientId: 'client-1',
  scopes: ['read', 'write'],
  access: {
    fundId: 'fund-1',
    userId: 'user-1',
    role: 'member',
    features: { ...DEFAULT_FEATURE_VISIBILITY } as FeatureVisibilityMap,
    grants: { accounting: 'write' },
    defaults: {},
  },
} as V1Principal

/** A stand-in for the one table this module touches, keyed the way its primary key is. */
function store() {
  const rows = new Map<string, Record<string, any>>()
  const keyOf = (m: Record<string, any>) => `${m.fund_id}|${m.client_id}|${m.endpoint}|${m.key}`
  const admin = {
    from(table: string) {
      if (table !== 'api_idempotency_keys') throw new Error(`Unexpected table ${table}`)
      return {
        insert: async (row: Record<string, any>) => {
          const k = keyOf(row)
          if (rows.has(k)) return { error: { code: '23505', message: 'duplicate key' } }
          rows.set(k, { ...row })
          return { error: null }
        },
        select: () => ({
          match: (m: Record<string, any>) => ({
            maybeSingle: async () => ({ data: rows.get(keyOf(m)) ?? null, error: null }),
          }),
        }),
        update: (patch: Record<string, any>) => ({
          match: async (m: Record<string, any>) => {
            const existing = rows.get(keyOf(m))
            if (existing) rows.set(keyOf(m), { ...existing, ...patch })
            return { error: null }
          },
        }),
        delete: () => ({
          match: async (m: Record<string, any>) => {
            rows.delete(keyOf(m))
            return { error: null }
          },
        }),
      }
    },
  }
  return { admin: admin as any, rows }
}

const ENDPOINT = 'POST /api/v1/pending-actions/:id/approve'
const fingerprint = requestFingerprint({ endpoint: ENDPOINT, actionId: 'action-1', userId: 'user-1' })

let db: ReturnType<typeof store>
beforeEach(() => {
  db = store()
})

describe('Idempotency-Key header', () => {
  it('rejects an absent, blank, or oversized key', () => {
    const at = (headers: Record<string, string>) =>
      idempotencyKeyFrom(new Request('https://reporting.test/x', { method: 'POST', headers }))
    expect(at({})).toBeNull()
    expect(at({ 'Idempotency-Key': '   ' })).toBeNull()
    expect(at({ 'Idempotency-Key': 'a'.repeat(201) })).toBeNull()
    expect(at({ 'Idempotency-Key': '  key-1 ' })).toBe('key-1')
  })
})

describe('claimIdempotentRequest', () => {
  it('lets the first request through', async () => {
    const claim = await claimIdempotentRequest(db.admin, principal, { endpoint: ENDPOINT, key: 'k1', fingerprint })
    expect(claim).toEqual({ kind: 'proceed' })
  })

  it('replays the stored response instead of approving twice', async () => {
    await claimIdempotentRequest(db.admin, principal, { endpoint: ENDPOINT, key: 'k1', fingerprint })
    await completeIdempotentRequest(db.admin, principal, {
      endpoint: ENDPOINT,
      key: 'k1',
      status: 200,
      body: { status: 'applied', actionId: 'action-1' },
    })

    const retry = await claimIdempotentRequest(db.admin, principal, { endpoint: ENDPOINT, key: 'k1', fingerprint })
    expect(retry).toEqual({
      kind: 'replay',
      status: 200,
      body: { status: 'applied', actionId: 'action-1' },
    })
  })

  it('refuses a second request that is still in flight rather than doubling the write', async () => {
    await claimIdempotentRequest(db.admin, principal, { endpoint: ENDPOINT, key: 'k1', fingerprint })
    const concurrent = await claimIdempotentRequest(db.admin, principal, { endpoint: ENDPOINT, key: 'k1', fingerprint })
    expect(concurrent).toMatchObject({ kind: 'conflict', code: 'IDEMPOTENCY_IN_PROGRESS' })
  })

  it('refuses a key reused for a DIFFERENT action — that is a client bug, not a retry', async () => {
    await claimIdempotentRequest(db.admin, principal, { endpoint: ENDPOINT, key: 'k1', fingerprint })
    const other = requestFingerprint({ endpoint: ENDPOINT, actionId: 'action-2', userId: 'user-1' })
    const reused = await claimIdempotentRequest(db.admin, principal, {
      endpoint: ENDPOINT,
      key: 'k1',
      fingerprint: other,
    })
    expect(reused).toMatchObject({ kind: 'conflict', code: 'IDEMPOTENCY_KEY_REUSED' })
  })

  it('keeps one OAuth client’s keys out of another’s', async () => {
    await claimIdempotentRequest(db.admin, principal, { endpoint: ENDPOINT, key: 'k1', fingerprint })
    const otherClient = { ...principal, clientId: 'client-2' } as V1Principal
    const claim = await claimIdempotentRequest(db.admin, otherClient, { endpoint: ENDPOINT, key: 'k1', fingerprint })
    expect(claim).toEqual({ kind: 'proceed' })
  })

  it('does not let a key cross endpoints', async () => {
    await claimIdempotentRequest(db.admin, principal, { endpoint: ENDPOINT, key: 'k1', fingerprint })
    const claim = await claimIdempotentRequest(db.admin, principal, {
      endpoint: 'POST /api/v1/pending-actions/:id/reject',
      key: 'k1',
      fingerprint,
    })
    expect(claim).toEqual({ kind: 'proceed' })
  })
})

describe('releasing a claim', () => {
  it('frees the key when the work failed, so a retry can genuinely try again', async () => {
    await claimIdempotentRequest(db.admin, principal, { endpoint: ENDPOINT, key: 'k1', fingerprint })
    await releaseIdempotentRequest(db.admin, principal, { endpoint: ENDPOINT, key: 'k1' })
    const retry = await claimIdempotentRequest(db.admin, principal, { endpoint: ENDPOINT, key: 'k1', fingerprint })
    expect(retry).toEqual({ kind: 'proceed' })
  })

  it('never remembers an error response as the outcome', async () => {
    await claimIdempotentRequest(db.admin, principal, { endpoint: ENDPOINT, key: 'k1', fingerprint })
    await completeIdempotentRequest(db.admin, principal, {
      endpoint: ENDPOINT,
      key: 'k1',
      status: 409,
      body: { error: { code: 'ACTION_NOT_PENDING' } },
    })
    expect(db.rows.size).toBe(0)
    const retry = await claimIdempotentRequest(db.admin, principal, { endpoint: ENDPOINT, key: 'k1', fingerprint })
    expect(retry).toEqual({ kind: 'proceed' })
  })
})
