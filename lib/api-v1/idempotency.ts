import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { V1Principal } from './principal'

/**
 * Idempotency for the /api/v1 write routes.
 *
 * The header was required and then discarded, which left the client no way to distinguish "the
 * approval did not happen" from "the approval happened and the response was lost". Retrying is the
 * only thing a phone can do about a dropped connection, and the retry of a SUCCESSFUL approval
 * used to come back as an error about an action that was no longer pending.
 *
 * So: claim the key first, execute, store the response, and replay it for any later request under
 * the same key. Three outcomes, and the caller must handle all three —
 *
 *   'proceed'  — the key is ours; run the work and call `completeIdempotentRequest`.
 *   'replay'   — this exact request already completed; return the stored status and body.
 *   'conflict' — the key is in flight, or is being reused for a DIFFERENT request. Refuse.
 *
 * The claim is a plain insert against the primary key, so two concurrent retries race in Postgres
 * rather than in the application: exactly one gets 'proceed'.
 */

export const IDEMPOTENCY_MAX_KEY_LENGTH = 200

export type IdempotencyOutcome =
  | { kind: 'proceed' }
  | { kind: 'replay'; status: number; body: Record<string, unknown> }
  | { kind: 'conflict'; code: string; message: string }

interface StoredRow {
  fingerprint: string
  status: 'in_progress' | 'completed'
  response_status: number | null
  response_body: Record<string, unknown> | null
}

/** What the caller asked for, condensed. A retry must match it; anything else is a client bug. */
export function requestFingerprint(parts: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

export function idempotencyKeyFrom(req: Request): string | null {
  const key = req.headers.get('idempotency-key')?.trim()
  if (!key || key.length > IDEMPOTENCY_MAX_KEY_LENGTH) return null
  return key
}

export async function claimIdempotentRequest(
  admin: SupabaseClient,
  principal: V1Principal,
  args: { endpoint: string; key: string; fingerprint: string },
): Promise<IdempotencyOutcome> {
  const identity = {
    fund_id: principal.fundId,
    client_id: principal.clientId,
    endpoint: args.endpoint,
    key: args.key,
  }

  const { error } = await admin.from('api_idempotency_keys').insert({
    ...identity,
    user_id: principal.userId,
    fingerprint: args.fingerprint,
    status: 'in_progress',
  })

  if (!error) return { kind: 'proceed' }
  // 23505 = unique_violation: someone claimed this key first. That someone may be this same
  // request arriving twice, which is the case worth handling well.
  if (error.code !== '23505') throw new Error(error.message)

  const { data, error: readError } = await admin
    .from('api_idempotency_keys')
    .select('fingerprint, status, response_status, response_body')
    .match(identity)
    .maybeSingle()
  if (readError) throw new Error(readError.message)

  // Gone between the insert and the read — a sweep, or a delete. Treat it as contention rather
  // than re-executing a write we cannot prove is safe.
  if (!data) {
    return { kind: 'conflict', code: 'IDEMPOTENCY_CONFLICT', message: 'This Idempotency-Key is already in use. Retry shortly.' }
  }

  const row = data as StoredRow
  if (row.fingerprint !== args.fingerprint) {
    return {
      kind: 'conflict',
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'This Idempotency-Key was already used for a different request.',
    }
  }
  if (row.status === 'completed' && row.response_status !== null) {
    return { kind: 'replay', status: row.response_status, body: row.response_body ?? {} }
  }
  // Still running. The first request holds the claim; the second waits rather than doubling the
  // write. 409 is retryable and the client knows it.
  return { kind: 'conflict', code: 'IDEMPOTENCY_IN_PROGRESS', message: 'An identical request is already in progress.' }
}

/**
 * Store what the client should get back on a retry.
 *
 * Only successful responses are stored. An error is not a durable outcome — the action is still
 * pending, and a retry should be allowed to genuinely try again — so a failed attempt releases its
 * claim instead.
 */
export async function completeIdempotentRequest(
  admin: SupabaseClient,
  principal: V1Principal,
  args: { endpoint: string; key: string; status: number; body: Record<string, unknown> },
): Promise<void> {
  const identity = {
    fund_id: principal.fundId,
    client_id: principal.clientId,
    endpoint: args.endpoint,
    key: args.key,
  }

  if (args.status >= 400) {
    await admin.from('api_idempotency_keys').delete().match(identity)
    return
  }

  await admin
    .from('api_idempotency_keys')
    .update({
      status: 'completed',
      response_status: args.status,
      response_body: args.body,
      completed_at: new Date().toISOString(),
    })
    .match(identity)
}

/** Release a claim whose work never ran or threw. */
export async function releaseIdempotentRequest(
  admin: SupabaseClient,
  principal: V1Principal,
  args: { endpoint: string; key: string },
): Promise<void> {
  await admin.from('api_idempotency_keys').delete().match({
    fund_id: principal.fundId,
    client_id: principal.clientId,
    endpoint: args.endpoint,
    key: args.key,
  })
}
