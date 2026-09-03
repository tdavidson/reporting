import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccessContext } from '@/lib/access/effective'
import type { ChatMessage, TokenUsage } from '@/lib/ai/types'
import type { AssistantProposal } from '@/lib/accounting/assistant'
import type { StagedActionRecord } from '@/lib/ai/analyst-tools'
import type { AnalystPresentationBlock } from './response'

/**
 * HOW the caller proved who they are — set where the credential is resolved, never read from a
 * request body.
 *
 * `oauth` and `cookie` are the same person by two doors, and neither carries a restriction the
 * access context does not already express. `demo` is different in kind: an anonymous visitor
 * sharing one account, who must be refused things a `viewer` with the same grants could do. Phase 8
 * sets it; nothing issues it yet.
 *
 * This exists so a restriction can be stated as a property of the CREDENTIAL rather than smuggled
 * in as a boolean on a request. A route that accepted `{ isDemo: true }` from a client would be
 * letting the caller describe their own constraints, which is not a constraint.
 */
export type CredentialKind = 'oauth' | 'cookie' | 'demo'

export interface AnalystPrincipal {
  userId: string
  fundId: string
  role: string
  access: AccessContext
  /**
   * Optional only so existing constructions keep compiling; treat an absent value as `cookie`,
   * which is what `credentialKindOf` does. Anything deciding on this must go through that helper
   * rather than reading the field, so the default lives in one place.
   */
  credentialKind?: CredentialKind
}

/** The credential kind, defaulting an unset one to the least-privileged interpretation available. */
export function credentialKindOf(principal: Pick<AnalystPrincipal, 'credentialKind'>): CredentialKind {
  return principal.credentialKind ?? 'cookie'
}

/**
 * A demo credential may read what its grants allow and change nothing — not stage, not approve,
 * not reject. Asked here rather than at each call site so the rule has one statement.
 */
export function isRestrictedCredential(principal: Pick<AnalystPrincipal, 'credentialKind'>): boolean {
  return credentialKindOf(principal) === 'demo'
}

export type AnalystDomain = 'portfolio' | 'funds' | 'lps' | 'accounting' | 'diligence'

export interface AnalystDocument {
  name?: string
  format?: string
  base64?: string
}

export interface AnalystRequest {
  messages: ChatMessage[]
  conversationId?: string
  /** Credential ceiling for transports with scoped tokens. Cookie-authenticated web defaults on. */
  allowDrafts?: boolean
  scope?: {
    companyId?: string
    dealId?: string
    vehicle?: string
    domain?: AnalystDomain
  }
  model?: { id: string; provider: string }
  document?: AnalystDocument
}

export interface AnalystUsageSummary extends TokenUsage {
  provider: string
  model: string
}

export interface AnalystResult {
  reply: string
  conversationId: string | null
  proposals: AssistantProposal[]
  vehicle: string | null
  scope: string | null
  toolCalls: Array<{ name: string }>
  stagedActions: StagedActionRecord[]
  blocks: AnalystPresentationBlock[]
  usage: AnalystUsageSummary
}

export interface AnalystRateLimitSpec {
  key: string
  limit: number
  windowSeconds: number
}

export interface AnalystDependencies {
  admin: SupabaseClient
  /** Transport-neutral adapter: true means this bucket is over its limit. */
  isRateLimited: (spec: AnalystRateLimitSpec) => Promise<boolean>
}

export class AnalystRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfter?: number,
  ) {
    super(message)
  }
}
