import { createAdminClient } from '@/lib/supabase/admin'
import { createFundAIProvider, createFundAIProviderWithOverride } from '@/lib/ai'
import { recommendedModel } from '@/lib/ai/recommended'
import type { AIProvider } from '@/lib/ai/types'

type Admin = ReturnType<typeof createAdminClient>

// Standalone (non-memo-agent) AI features that have their own model selector.
export type AIFeature = 'deal_classify' | 'deal_analysis' | 'portfolio'

export interface FeatureProvider {
  provider: AIProvider
  model: string
  providerType: string
}

interface FeatureOverride {
  provider?: string
  model?: string
}

/**
 * Resolve the AI provider + model for a standalone feature, honoring the fund's
 * per-feature override (fund_settings.ai_feature_models) and otherwise using
 * the recommended model tier on the fund default provider.
 *
 * Back-compat: the legacy `routing_model` text field seeds `deal_classify` when
 * no structured override exists.
 */
export async function getFeatureProvider(admin: Admin, fundId: string, feature: AIFeature): Promise<FeatureProvider> {
  const { data: settings } = await admin
    .from('fund_settings')
    .select('ai_feature_models, routing_model')
    .eq('fund_id', fundId)
    .maybeSingle()

  const overrides = ((settings as any)?.ai_feature_models as Record<string, FeatureOverride | null> | null) ?? {}
  let override = overrides[feature] ?? null

  // Legacy routing_model (model-only) seeds the classifier if not set explicitly.
  if (!override && feature === 'deal_classify') {
    const rm = (settings as any)?.routing_model as string | null
    if (rm) override = { model: rm }
  }

  if (override?.provider) {
    const result = await createFundAIProviderWithOverride(admin, fundId, override.provider)
    return { provider: result.provider, model: override.model || result.model, providerType: result.providerType }
  }

  const def = await createFundAIProvider(admin, fundId)
  if (override?.model) {
    // Model-only override on the fund default provider.
    return { provider: def.provider, model: override.model, providerType: def.providerType }
  }
  // No override — recommended tier for this feature on the fund default provider.
  return { provider: def.provider, model: recommendedModel(feature, def.providerType, def.model), providerType: def.providerType }
}
