import type { TokenUsage } from './types'

type SupabaseAdmin = { from: (table: string) => any }

export async function logAIUsage(admin: SupabaseAdmin, params: {
  fundId: string
  userId?: string
  /** Diligence deal this spend belongs to, when applicable — enables per-deal
   *  token/cost reporting. Left null for non-deal usage. */
  dealId?: string
  provider: string
  model: string
  feature: string
  usage: TokenUsage
}) {
  try {
    await admin.from('ai_usage_logs').insert({
      fund_id: params.fundId,
      user_id: params.userId ?? null,
      deal_id: params.dealId ?? null,
      provider: params.provider,
      model: params.model,
      feature: params.feature,
      input_tokens: params.usage.inputTokens,
      output_tokens: params.usage.outputTokens,
      cache_read_tokens: params.usage.cacheReadTokens ?? 0,
      cache_creation_tokens: params.usage.cacheCreationTokens ?? 0,
    })
  } catch (err) {
    console.error('[ai-usage] Failed to log usage:', err)
  }
}
