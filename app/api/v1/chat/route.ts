import { createAdminClient } from '@/lib/supabase/admin'
import { runAnalyst } from '@/lib/ai/analyst/orchestrator'
import { AnalystRequestError } from '@/lib/ai/analyst/types'
import { chatDependencies, prepareChatRequest } from '@/lib/api-v1/chat-request'
import { V1PrincipalError } from '@/lib/api-v1/principal'
import { requestId, v1Error, v1Json } from '@/lib/api-v1/response'

/**
 * Non-streaming chat. Preserved as the fallback and as the contract-testing surface: a client on a
 * network that mangles SSE, and a test that wants one JSON body to assert against, both need it.
 *
 * Everything before the run is `prepareChatRequest`, shared with the streaming route so there is
 * one definition of a valid chat request rather than two that drift.
 */
export async function POST(req: Request) {
  const id = requestId()
  const admin = createAdminClient()
  try {
    const { principal, request } = await prepareChatRequest(admin, req)
    const result = await runAnalyst(principal, request, chatDependencies(admin, principal))

    return v1Json({
      reply: result.reply,
      conversationId: result.conversationId,
      scope: result.scope,
      vehicle: result.vehicle,
      blocks: result.blocks,
      proposals: result.proposals,
      toolCalls: result.toolCalls,
      stagedActions: result.stagedActions.map(action => ({
        id: action.id,
        actionType: action.actionType,
        preview: action.preview,
      })),
      usage: result.usage,
    }, { requestId: id })
  } catch (error) {
    if (error instanceof V1PrincipalError || error instanceof AnalystRequestError) {
      const headers = error instanceof AnalystRequestError && error.retryAfter
        ? { 'Retry-After': String(error.retryAfter) }
        : undefined
      return v1Error(error.code, error.message, error.status, id, headers)
    }
    console.error(`[api-v1] ${id} POST /chat failed`, error)
    return v1Error('INTERNAL_ERROR', 'The request could not be completed.', 500, id)
  }
}
