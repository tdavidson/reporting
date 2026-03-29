export type FeatureKey = 'interactions' | 'investments' | 'funds' | 'notes' | 'lp_letters' | 'imports' | 'asks' | 'lps' | 'lp_associates' | 'compliance' | 'vc_market'

export type FeatureVisibility = 'everyone' | 'admin' | 'hidden' | 'off'

export type FeatureVisibilityMap = Record<FeatureKey, FeatureVisibility>

export const DEFAULT_FEATURE_VISIBILITY: FeatureVisibilityMap = {
  interactions: 'everyone',
  investments: 'everyone',
  funds: 'everyone',
  notes: 'everyone',
  lp_letters: 'everyone',
  imports: 'everyone',
  asks: 'everyone',
  lps: 'admin',
  lp_associates: 'admin',
  compliance: 'admin',
  vc_market: 'everyone',
}

/** Features that support the "off" level (functionally disabled) */
export const FEATURES_WITH_OFF: FeatureKey[] = ['interactions']

/**
 * Returns true if the feature should be visible to the current user.
 * - "everyone": always visible
 * - "admin": visible only to admins
 * - "hidden": removed from navigation (feature still works if accessed directly)
 * - "off": functionally disabled, hidden from everyone
 */
export function isFeatureVisible(
  featureVisibility: FeatureVisibilityMap | null | undefined,
  key: FeatureKey,
  isAdmin: boolean
): boolean {
  const level = featureVisibility?.[key] ?? DEFAULT_FEATURE_VISIBILITY[key]
  switch (level) {
    case 'everyone':
      return true
    case 'admin':
      return isAdmin
    case 'hidden':
    case 'off':
      return false
  }
}
