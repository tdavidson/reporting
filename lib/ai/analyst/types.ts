import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccessContext } from '@/lib/access/effective'
import type { ChatMessage, TokenUsage } from '@/lib/ai/types'
import type { AssistantProposal } from '@/lib/accounting/assistant'
import type { StagedActionRecord } from '@/lib/ai/analyst-tools'
import type { AnalystPresentationBlock } from './response'

export interface AnalystPrincipal {
  userId: string
  fundId: string
  role: string
  access: AccessContext
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
