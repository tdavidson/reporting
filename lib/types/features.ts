export type FeatureKey = 'interactions' | 'investments' | 'notes' | 'lp_letters' | 'imports' | 'asks' | 'lps' | 'lp_tracking' | 'lp_associates' | 'lp_portal' | 'lp_activity' | 'compliance' | 'deals' | 'diligence' | 'accounting' | 'gp_economics'

export type FeatureVisibility = 'everyone' | 'admin' | 'hidden' | 'off'

export type FeatureVisibilityMap = Record<FeatureKey, FeatureVisibility>

export const DEFAULT_FEATURE_VISIBILITY: FeatureVisibilityMap = {
  interactions: 'off',
  investments: 'everyone',
  // NOTE: there is deliberately no `funds` key any more. The Funds page moved INTO the
  // accounting section (it is now /funds, the section's landing page) and its numbers are
  // derived from the ledger — so it is gated by `accounting`, and a fund with accounting off
  // has no books to derive them from. The old `funds` key gated a page that no longer exists;
  // leaving it would have been a settings toggle that silently controlled nothing.
  notes: 'off',
  lp_letters: 'off',
  imports: 'everyone',
  asks: 'admin',
  lps: 'off',
  // LP capital: per-vehicle LP capital. Its source is NOT a mode the user picks — capital is
  // derived from the ledger for a vehicle that keeps books (accounting on + set up), and pasted
  // as dated positions otherwise. This flag only decides whether the fund reports LP capital at
  // ALL; it is independent of `accounting` and can be off even when the books are on.
  lp_tracking: 'off',
  lp_associates: 'admin',
  lp_portal: 'off',
  lp_activity: 'off',
  compliance: 'off',
  deals: 'off',
  diligence: 'off',
  accounting: 'off',
  // Carry terms, carry accrued/paid per partner, per-deal carry, GP ownership. Split out of
  // `accounting` — a fund must be able to let someone reconcile the bank without showing them the
  // partners' carry. Admin-only by default: opening it to members is a deliberate act, and even
  // then each member needs the gp_economics grant (see lib/access/domains.ts).
  gp_economics: 'admin',
}

/**
 * Returns true if the feature is switched on for this user at the FUND level.
 *
 * This is the ceiling, not the answer: what a given member may actually read or write is
 * `effectiveAccess` in lib/access/effective.ts, which consults this and then their per-user grant.
 * Prefer that everywhere; this is exported for the nav and for the grant resolver itself.
 *
 * - "everyone": on; members reach it subject to their grant
 * - "admin": on; admins only, whatever a member's grant says
 * - "off": DENIED to everyone, admins included. The data is retained; nothing serves it. Turning
 *   `interactions` off also stops the email pipeline extracting them (lib/pipeline/processEmail.ts)
 *   — the only place `off` does anything beyond denying.
 * - "hidden": LEGACY, identical to "off". Still accepted so stored rows keep working; no longer
 *   offered in Settings.
 *
 * `off` and `hidden` deny rather than merely un-nav. `hidden` used to mean "removed from
 * navigation (feature still works if accessed directly)" — which is not access control: the nav
 * hid the panel while the API underneath happily served the data. Once that was fixed, `hidden`
 * and `off` became the same thing, so Settings stopped offering both.
 * See plans/plan-access-control.md.
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
