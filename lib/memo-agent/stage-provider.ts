import { createAdminClient } from '@/lib/supabase/admin'
import { createFundAIProvider, createFundAIProviderWithOverride } from '@/lib/ai'
import { recommendedModel } from '@/lib/ai/recommended'
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
  /**
   * Whether the fund opted into web search, independent of whether it's
   * actually available. When this is true but webSearchAvailable is false,
   * the stage isn't running on Anthropic — surfaced as a warning so the
   * opt-in doesn't silently do nothing.
   */
  webSearchOptIn: boolean
}

interface StageOverride {
  provider?: string
  model?: string
}

// Sub-stages of data-room ingestion inherit the 'ingest' override when they
// don't have one of their own, so an existing Ingest setting keeps governing
// the whole ingestion pass (per-doc + synthesis + checklist).
const STAGE_OVERRIDE_FALLBACK: Partial<Record<AgentStage, AgentStage>> = {
  ingest_synthesis: 'ingest',
  checklist_assessment: 'ingest',
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
  const fallbackStage = STAGE_OVERRIDE_FALLBACK[stage]
  const override = overrides[stage] ?? (fallbackStage ? overrides[fallbackStage] : null) ?? null

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
    // No override — use the fund default provider, but pick the recommended
    // model tier for this stage (fast for ingestion, strong for draft review).
    const def = await createFundAIProvider(admin, fundId)
    resolved = { ...def, model: recommendedModel(stage, def.providerType, def.model) }
  }

  return {
    ...resolved,
    webSearchAvailable: stage === 'research' && webSearchOptIn && resolved.providerType === 'anthropic',
    webSearchOptIn,
  }
}
