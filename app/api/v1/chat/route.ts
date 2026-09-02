import { createAdminClient } from '@/lib/supabase/admin'
import { runAnalyst } from '@/lib/ai/analyst/orchestrator'
import { AnalystRequestError, type AnalystDomain } from '@/lib/ai/analyst/types'
import { getConversation } from '@/lib/api-v1/conversations'
import { resolveV1Principal, V1PrincipalError } from '@/lib/api-v1/principal'
import { requestId, v1Error, v1Json } from '@/lib/api-v1/response'
import { rateLimit } from '@/lib/rate-limit'

const DOMAINS: AnalystDomain[] = ['portfolio', 'funds', 'lps', 'accounting', 'diligence']

interface V1ChatBody {
  message?: unknown
  conversationId?: unknown
  scope?: unknown
  clientCapabilities?: unknown
}

function parseScope(value: unknown) {
  if (value == null) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AnalystRequestError('scope must be an object.', 400, 'INVALID_REQUEST')
  }
  const raw = value as Record<string, unknown>
  const scope: { companyId?: string; dealId?: string; vehicle?: string; domain?: AnalystDomain } = {}
  for (const field of ['companyId', 'dealId', 'vehicle'] as const) {
    if (raw[field] != null && typeof raw[field] !== 'string') {
      throw new AnalystRequestError(`scope.${field} must be a string.`, 400, 'INVALID_REQUEST')
    }
    if (typeof raw[field] === 'string' && raw[field].trim()) scope[field] = raw[field].trim()
  }
  if (raw.domain != null) {
    if (typeof raw.domain !== 'string' || !DOMAINS.includes(raw.domain as AnalystDomain)) {
      throw new AnalystRequestError('scope.domain is invalid.', 400, 'INVALID_REQUEST')
    }
    scope.domain = raw.domain as AnalystDomain
  }
  return scope
}

async function limited(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  return !!(await rateLimit({ key, limit, windowSeconds }))
}

export async function POST(req: Request) {
  const id = requestId()
  const admin = createAdminClient()
  try {
    const principal = await resolveV1Principal(admin, req)
    if (await limited(`api-v1-chat:user:${principal.userId}`, 30, 300)
      || await limited(`api-v1-chat:fund:${principal.fundId}`, 300, 300)) {
      return v1Error('RATE_LIMITED', 'Too many requests. Please try again later.', 429, id, { 'Retry-After': '300' })
    }

    let body: V1ChatBody
    try {
      body = await req.json() as V1ChatBody
    } catch {
      return v1Error('INVALID_JSON', 'The request body must be valid JSON.', 400, id)
    }
    if (typeof body.message !== 'string' || !body.message.trim()) {
      return v1Error('INVALID_REQUEST', 'message is required.', 400, id)
    }
    if (body.message.length > 10_000) {
      return v1Error('INVALID_REQUEST', 'message must be 10,000 characters or fewer.', 400, id)
    }
    if (body.conversationId != null && typeof body.conversationId !== 'string') {
      return v1Error('INVALID_REQUEST', 'conversationId must be a string or null.', 400, id)
    }

    let messages: Array<{ role: 'user' | 'assistant'; content: string }> = []
    const conversationId = typeof body.conversationId === 'string' && body.conversationId
      ? body.conversationId
      : undefined
    if (conversationId) {
      const conversation = await getConversation(admin, principal, conversationId)
      if (!conversation) return v1Error('CONVERSATION_NOT_FOUND', 'Conversation not found.', 404, id)
      messages = conversation.messages
    }
    messages.push({ role: 'user', content: body.message.trim() })

    const result = await runAnalyst(principal, {
      messages,
      conversationId,
      scope: parseScope(body.scope),
      allowDrafts: principal.scopes.includes('write'),
    }, {
      admin,
      isRateLimited: spec => limited(`api-v1:${principal.fundId}:${spec.key}`, spec.limit, spec.windowSeconds),
    })

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

