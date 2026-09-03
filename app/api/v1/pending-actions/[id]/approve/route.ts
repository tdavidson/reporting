import { expireTag } from '@/lib/cache/tags'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireV1Write, resolveV1Principal, V1PrincipalError } from '@/lib/api-v1/principal'
import { requestId, v1Error, v1Json } from '@/lib/api-v1/response'
import {
  claimIdempotentRequest,
  completeIdempotentRequest,
  idempotencyKeyFrom,
  releaseIdempotentRequest,
  requestFingerprint,
} from '@/lib/api-v1/idempotency'
import { approvePendingAction, PendingActionServiceError } from '@/lib/pending-actions/service'

const ENDPOINT = 'POST /api/v1/pending-actions/:id/approve'

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const requestID = requestId()
  const key = idempotencyKeyFrom(req)
  if (!key) {
    return v1Error('IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.', 400, requestID)
  }
  const admin = createAdminClient()
  try {
    const principal = await resolveV1Principal(admin, req)
    requireV1Write(principal)

    // Claimed AFTER the principal resolves, so an unauthenticated prober cannot burn another
    // client's keys, and before the write, so two retries race in Postgres rather than both
    // approving.
    const claim = await claimIdempotentRequest(admin, principal, {
      endpoint: ENDPOINT,
      key,
      fingerprint: requestFingerprint({ endpoint: ENDPOINT, actionId: params.id, userId: principal.userId }),
    })
    if (claim.kind === 'replay') {
      return v1Json(claim.body, { requestId: requestID, headers: { 'Idempotent-Replay': 'true' } })
    }
    if (claim.kind === 'conflict') {
      return v1Error(claim.code, claim.message, 409, requestID)
    }

    try {
      const result = await approvePendingAction(admin, principal, params.id)
      expireTag('pending-actions-badge')
      await completeIdempotentRequest(admin, principal, { endpoint: ENDPOINT, key, status: 200, body: result })
      return v1Json(result, { requestId: requestID })
    } catch (error) {
      // The approval did not happen, so the key must not remember that it did: a client retrying
      // after a transient failure has to be able to actually try again.
      await releaseIdempotentRequest(admin, principal, { endpoint: ENDPOINT, key })
      throw error
    }
  } catch (error) {
    if (error instanceof V1PrincipalError || error instanceof PendingActionServiceError) {
      return v1Error(error.code, error.message, error.status, requestID)
    }
    console.error(`[api-v1] ${requestID} POST /pending-actions/:id/approve failed`, error)
    return v1Error('INTERNAL_ERROR', 'The request could not be completed.', 500, requestID)
  }
}
