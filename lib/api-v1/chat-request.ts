import type { SupabaseClient } from '@supabase/supabase-js'
import { AnalystRequestError, isRestrictedCredential, type AnalystDomain, type AnalystRequest } from '@/lib/ai/analyst/types'
import { getConversation } from './conversations'
import { resolveV1Principal, type V1Principal } from './principal'
import { rateLimit } from '@/lib/rate-limit'

/**
 * Everything `POST /api/v1/chat` and `POST /api/v1/chat/stream` do before the Analyst runs.
 *
 * Shared because the two differ only in how they return the answer. Duplicating the parsing would
 * mean two definitions of what a valid chat request is, and the streaming one would be the copy
 * that drifts — it is the one nobody exercises from a browser.
 *
 * Throws `AnalystRequestError` / `V1PrincipalError`, both of which carry the status and code the v1
 * envelope needs, so each route's existing catch already handles them.
 */

const DOMAINS: AnalystDomain[] = ['portfolio', 'funds', 'lps', 'accounting', 'diligence']

const MAX_MESSAGE_LENGTH = 10_000

interface V1ChatBody {
  message?: unknown
  conversationId?: unknown
  scope?: unknown
  clientCapabilities?: unknown
}

export interface PreparedChatRequest {
  principal: V1Principal
  request: AnalystRequest
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

/**
 * Resolve the caller, rate-limit them, validate the body, and load any prior turns.
 *
 * The rate limits are per user AND per fund, and they are applied here so the streaming transport
 * cannot become the cheap way around them — an endpoint that holds a connection open is the last
 * one that should be unmetered.
 */
export async function prepareChatRequest(
  admin: SupabaseClient,
  req: Request,
): Promise<PreparedChatRequest> {
  const principal = await resolveV1Principal(admin, req)

  if (await limited(`api-v1-chat:user:${principal.userId}`, 30, 300)
    || await limited(`api-v1-chat:fund:${principal.fundId}`, 300, 300)) {
    throw new AnalystRequestError('Too many requests. Please try again later.', 429, 'RATE_LIMITED', 300)
  }

  let body: V1ChatBody
  try {
    body = await req.json() as V1ChatBody
  } catch {
    throw new AnalystRequestError('The request body must be valid JSON.', 400, 'INVALID_JSON')
  }
  if (typeof body.message !== 'string' || !body.message.trim()) {
    throw new AnalystRequestError('message is required.', 400, 'INVALID_REQUEST')
  }
  if (body.message.length > MAX_MESSAGE_LENGTH) {
    throw new AnalystRequestError(`message must be ${MAX_MESSAGE_LENGTH.toLocaleString()} characters or fewer.`, 400, 'INVALID_REQUEST')
  }
  if (body.conversationId != null && typeof body.conversationId !== 'string') {
    throw new AnalystRequestError('conversationId must be a string or null.', 400, 'INVALID_REQUEST')
  }

  const conversationId = typeof body.conversationId === 'string' && body.conversationId
    ? body.conversationId
    : undefined

  let messages: Array<{ role: 'user' | 'assistant'; content: string }> = []
  if (conversationId) {
    // Scoped to the token's user AND fund inside `getConversation`, so a conversation belonging to
    // someone else is indistinguishable from one that does not exist.
    const conversation = await getConversation(admin, principal, conversationId)
    if (!conversation) {
      throw new AnalystRequestError('Conversation not found.', 404, 'CONVERSATION_NOT_FOUND')
    }
    messages = conversation.messages
  }
  messages.push({ role: 'user', content: body.message.trim() })

  return {
    principal,
    request: {
      messages,
      conversationId,
      scope: parseScope(body.scope),
      // Two ceilings, both server-side: the token's scope, and the credential's kind. A demo
      // credential never stages, so the model is never offered a write tool to stage with.
      allowDrafts: principal.scopes.includes('write') && !isRestrictedCredential(principal),
    },
  }
}

/** The Analyst's own per-fund tool rate limiter, shared by both transports. */
export function chatDependencies(admin: SupabaseClient, principal: V1Principal) {
  return {
    admin,
    isRateLimited: (spec: { key: string; limit: number; windowSeconds: number }) =>
      limited(`api-v1:${principal.fundId}:${spec.key}`, spec.limit, spec.windowSeconds),
  }
}
