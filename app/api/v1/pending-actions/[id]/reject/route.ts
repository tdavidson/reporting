import { expireTag } from '@/lib/cache/tags'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireV1Write, resolveV1Principal, V1PrincipalError } from '@/lib/api-v1/principal'
import { requestId, v1Error, v1Json } from '@/lib/api-v1/response'
import { PendingActionServiceError, rejectPendingAction } from '@/lib/pending-actions/service'

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const requestID = requestId()
  const admin = createAdminClient()
  try {
    const principal = await resolveV1Principal(admin, req)
    requireV1Write(principal)
    const result = await rejectPendingAction(admin, principal, params.id)
    expireTag('pending-actions-badge')
    return v1Json(result, { requestId: requestID })
  } catch (error) {
    if (error instanceof V1PrincipalError || error instanceof PendingActionServiceError) {
      return v1Error(error.code, error.message, error.status, requestID)
    }
    console.error(`[api-v1] ${requestID} POST /pending-actions/:id/reject failed`, error)
    return v1Error('INTERNAL_ERROR', 'The request could not be completed.', 500, requestID)
  }
}

