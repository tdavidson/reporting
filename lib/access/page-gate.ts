// Page-level access for server components: the same resolver the API gate and the nav use.
//
// A page is not a security boundary — its APIs are, and the middleware gates those. But a page
// that renders for someone whose every request 403s is a broken page, and one that renders data
// straight from a server component would be a leak. So server components that show a domain's
// data resolve it here rather than reimplementing a rule.
//
// See plans/plan-access-control.md.

import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasAccess, loadAccessContext, type AccessContext } from './effective'
import type { Domain } from './domains'
import type { FeatureKey } from '@/lib/types/features'

export interface PageAccess {
  fundId: string
  role: string
  isAdmin: boolean
  access: AccessContext
}

/**
 * Resolve the caller's fund + access, or null when they have no membership.
 *
 * Returns rather than redirects: a page decides where to send someone (usually /dashboard).
 *
 * Memoised per REQUEST (React `cache`), not across requests: several pages resolve it
 * twice on one render — a section guard and then the page itself, e.g. the Funds
 * section — and that was two membership lookups plus two access-context loads for one
 * navigation. Nothing is remembered between requests, so a grant changed in Settings
 * still applies to the very next one.
 */
export const resolvePageAccess = cache(async (userId: string): Promise<PageAccess | null> => {
  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', userId)
    .maybeSingle()
  if (!membership) return null

  const access = await loadAccessContext(admin, membership.fund_id, userId, membership.role)
  return {
    fundId: membership.fund_id,
    role: membership.role,
    isAdmin: membership.role === 'admin',
    access,
  }
})

/** Can this page's viewer read the domain it shows? */
export function canViewPage(page: PageAccess, domain: Domain, feature?: FeatureKey): boolean {
  return hasAccess(page.access, domain, 'read', feature)
}
