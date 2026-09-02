import { createAdminClient } from '@/lib/supabase/admin'
import { deleteConversation, getConversation } from '@/lib/api-v1/conversations'
import { resolveV1Principal, V1PrincipalError } from '@/lib/api-v1/principal'
import { requestId, v1Error, v1Json } from '@/lib/api-v1/response'

// Authenticated and per-request by construction: it reads the caller's bearer token. Saying so
// explicitly keeps `next build` from probing it as a static route and logging the bailout.
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const requestID = requestId()
  const admin = createAdminClient()
  try {
    const principal = await resolveV1Principal(admin, req)
    const conversation = await getConversation(admin, principal, params.id)
    if (!conversation) return v1Error('NOT_FOUND', 'Conversation not found.', 404, requestID)
    return v1Json({ conversation }, { requestId: requestID })
  } catch (error) {
    if (error instanceof V1PrincipalError) return v1Error(error.code, error.message, error.status, requestID)
    console.error(`[api-v1] ${requestID} GET /conversations/:id failed`, error)
    return v1Error('INTERNAL_ERROR', 'The request could not be completed.', 500, requestID)
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const requestID = requestId()
  const admin = createAdminClient()
  try {
    const principal = await resolveV1Principal(admin, req)
    const deleted = await deleteConversation(admin, principal, params.id)
    if (!deleted) return v1Error('NOT_FOUND', 'Conversation not found.', 404, requestID)
    return v1Json({ ok: true }, { requestId: requestID })
  } catch (error) {
    if (error instanceof V1PrincipalError) return v1Error(error.code, error.message, error.status, requestID)
    console.error(`[api-v1] ${requestID} DELETE /conversations/:id failed`, error)
    return v1Error('INTERNAL_ERROR', 'The request could not be completed.', 500, requestID)
  }
}

