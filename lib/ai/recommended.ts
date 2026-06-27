// Recommended per-stage / per-feature model tiers. These are the built-in
// defaults used when a stage/feature has no explicit override: structured
// high-volume work runs on a fast model, judgement/prose on the balanced
// (fund-default) model, and the final quality pass on the strongest model.
//
// "balanced" always resolves to the fund's chosen default model, so changing
// the fund default still moves the bulk of the work. "fast" / "strong" map to
// concrete models per provider (Anthropic today); other providers fall back to
// the fund default so we never inject a model id that provider can't serve.

export type ModelTier = 'fast' | 'balanced' | 'strong'

// Stage keys (memo-agent) + feature keys (deals/portfolio) → recommended tier.
export const RECOMMENDED_TIER: Record<string, ModelTier> = {
  // memo-agent stages
  ingest: 'fast',
  ingest_synthesis: 'fast',
  checklist_assessment: 'fast',
  research: 'balanced',
  qa: 'balanced',
  draft: 'balanced',
  draft_review: 'strong',
  score: 'balanced',
  // standalone features
  deal_classify: 'fast',
  deal_analysis: 'balanced',
  portfolio: 'balanced',
}

// Concrete fast/strong models per provider. Omitted providers fall back to the
// fund default model for those tiers (no risky hardcoded ids).
const TIER_MODELS: Record<string, { fast?: string; strong?: string }> = {
  anthropic: { fast: 'claude-haiku-4-5-20251001', strong: 'claude-opus-4-8' },
}

/**
 * Resolve the recommended model for a tier, given the fund's default provider
 * type and default model. Balanced (and any unmapped tier/provider) = the fund
 * default model.
 */
export function modelForTier(tier: ModelTier, providerType: string, fundDefaultModel: string): string {
  if (tier === 'balanced') return fundDefaultModel
  return TIER_MODELS[providerType]?.[tier] ?? fundDefaultModel
}

/** Recommended model for a specific stage/feature key. */
export function recommendedModel(key: string, providerType: string, fundDefaultModel: string): string {
  return modelForTier(RECOMMENDED_TIER[key] ?? 'balanced', providerType, fundDefaultModel)
}
