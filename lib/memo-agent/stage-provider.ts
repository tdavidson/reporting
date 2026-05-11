import { createAdminClient } from '@/lib/supabase/admin'
import { createFundAIProvider, createFundAIProviderWithOverride } from '@/lib/ai'
import type { AIProvider } from '@/lib/ai/types'
import type { AgentStage } from './cost'

type Admin = ReturnType<typeof createAdminClient>

export interface StageProvider {
  provider: AIProvider
  model: string
  providerType: string
  /**
   * True only for the research stage when (a) the fund has opted in via
   * fund_settings.memo_agent_web_search_enabled and (b) the resolved provider
   * is Anthropic (the only provider currently wired through `createMessage`).
   * Other stages and other providers always get false.
   */
  webSearchAvailable: boolean
}

interface StageOverride {
  provider?: string
  model?: string
}

/**
 * Resolve the AI provider + model for a given stage, honoring the fund's
 * per-stage overrides if set. Falls back to the fund default.
 */
export async function getStageProvider(admin: Admin, fundId: string, stage: AgentStage): Promise<StageProvider> {
  const { data: settings } = await admin
    .from('fund_settings')
    .select('memo_agent_stage_models, memo_agent_web_search_enabled')
    .eq('fund_id', fundId)
    .maybeSingle()

  const overrides = ((settings as any)?.memo_agent_stage_models as Record<string, StageOverride | null> | null) ?? {}
  const webSearchOptIn = !!(settings as any)?.memo_agent_web_search_enabled
  const override = overrides[stage] ?? null

  let resolved: { provider: AIProvider; model: string; providerType: string }
  if (override?.provider) {
    const result = await createFundAIProviderWithOverride(admin, fundId, override.provider)
    resolved = {
      provider: result.provider,
      // Per-stage model override is rarer than provider override; honor it when set.
      model: override.model || result.model,
      providerType: result.providerType,
    }
  } else {
    resolved = await createFundAIProvider(admin, fundId)
  }

  return {
    ...resolved,
    webSearchAvailable: stage === 'research' && webSearchOptIn && resolved.providerType === 'anthropic',
  }
}
