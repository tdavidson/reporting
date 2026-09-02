import { createAdminClient } from '@/lib/supabase/admin'
import { resolveV1Principal, V1PrincipalError } from '@/lib/api-v1/principal'
import { requestId, v1Error, v1Json } from '@/lib/api-v1/response'
import { ConversationRequestError, conversationLimit, listConversations } from '@/lib/api-v1/conversations'

// Authenticated and per-request by construction: it reads the caller's bearer token. Saying so
// explicitly keeps `next build` from probing it as a static route and logging the bailout.
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const id = requestId()
  const admin = createAdminClient()
  try {
    const principal = await resolveV1Principal(admin, req)
    const url = new URL(req.url)
    const result = await listConversations(admin, principal, {
      limit: conversationLimit(url.searchParams.get('limit')),
      cursor: url.searchParams.get('cursor'),
    })
    return v1Json(result, { requestId: id })
  } catch (error) {
    if (error instanceof V1PrincipalError || error instanceof ConversationRequestError) {
      return v1Error(error.code, error.message, error.status, id)
    }
    console.error(`[api-v1] ${id} GET /conversations failed`, error)
    return v1Error('INTERNAL_ERROR', 'The request could not be completed.', 500, id)
  }
}

