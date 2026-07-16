import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkForUpdate } from '@/lib/version'

// Badge counts — short TTL (revalidated on mutation + 60s fallback)
export const getReviewBadge = unstable_cache(
  async (fundId: string) => {
    const admin = createAdminClient()
    const [reviews, emails] = await Promise.all([
      admin
        .from('parsing_reviews')
        .select('id', { count: 'exact', head: true })
        .is('resolution', null)
        .eq('fund_id', fundId),
      admin
        .from('inbound_emails')
        .select('id', { count: 'exact', head: true })
        .eq('processing_status', 'needs_review')
        .eq('fund_id', fundId),
    ])
    return (reviews.count ?? 0) + (emails.count ?? 0)
  },
  ['review-badge'],
  { tags: ['review-badge'], revalidate: 60 }
)

export const getNotesBadge = unstable_cache(
  async (userId: string) => {
    const admin = createAdminClient()
    const { data } = await admin.rpc('count_unread_notes', { p_user_id: userId })
    return (data as number) ?? 0
  },
  ['notes-badge'],
  { tags: ['notes-badge'], revalidate: 60 }
)

export const getPendingRequests = unstable_cache(
  async (fundId: string) => {
    const admin = createAdminClient()
    const { count } = await admin
      .from('fund_join_requests' as any)
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .eq('fund_id', fundId)
    return count ?? 0
  },
  ['pending-requests'],
  { tags: ['pending-requests'], revalidate: 60 }
)

// Fund data — longer TTL (rarely changes)
export const getFundData = unstable_cache(
  async (fundId: string) => {
    const admin = createAdminClient()
    const { data } = await admin
      .from('funds')
      .select('id, name, logo_url')
      .eq('id', fundId)
      .single()
    return data as { id: string; name: string; logo_url: string | null } | null
  },
  ['fund-data'],
  { tags: ['fund-data'], revalidate: 300 }
)

export const getFundSettings = unstable_cache(
  async (fundId: string) => {
    const admin = createAdminClient()
    // Cast: `theme` is a recently-added column not yet in the generated types.
    const { data } = await (admin as any)
      .from('fund_settings')
      .select(
        'currency, claude_api_key_encrypted, openai_api_key_encrypted, gemini_api_key_encrypted, ollama_base_url, default_ai_provider, analytics_fathom_site_id, analytics_ga_measurement_id, feature_visibility, theme, lp_portal_enabled'
      )
      .eq('fund_id', fundId)
      .maybeSingle()
    return data as any
  },
  ['fund-settings'],
  { tags: ['fund-settings'], revalidate: 300 }
)

export const getUpdateAvailable = unstable_cache(
  async () => {
    const result = await checkForUpdate()
    return result?.hasUpdate ?? false
  },
  ['update-available'],
  { revalidate: 3600 }
)

export const getMembership = unstable_cache(
  async (userId: string, fundId: string) => {
    const admin = createAdminClient()
    const { data } = await admin
      .from('fund_members')
      .select('role')
      .eq('user_id', userId)
      .eq('fund_id', fundId)
      .maybeSingle()
    return data as { role: string } | null
  },
  ['membership'],
  { tags: ['membership'], revalidate: 300 }
)

/**
 * A user's per-domain grants, for the layout to resolve their effective access once and hand the
 * result to the client (see components/access-context.tsx).
 *
 * Cached like the rest of the layout's reads, and tagged so revoking a grant can invalidate it.
 * The cache is safe because it only drives WHAT THE NAV SHOWS: every API call re-resolves access
 * live in the middleware, uncached, so a revoked grant stops working immediately even if a stale
 * sidebar still offers the link.
 */
export const getDomainGrants = unstable_cache(
  async (userId: string, fundId: string) => {
    const admin = createAdminClient()
    const [{ data: grants, error: grantsError }, { data: defaults, error: defaultsError }] = await Promise.all([
      admin.from('fund_member_access' as any).select('domain, level').eq('fund_id', fundId).eq('user_id', userId),
      admin.from('fund_domain_defaults' as any).select('domain, level').eq('fund_id', fundId),
    ])

    // THROW, don't return empty. An empty grant set is indistinguishable from "this user is
    // allowed nothing", so swallowing the error would cache a transient blip AS A DENIAL for the
    // full 300s — stripping the nav to two items for anyone whose request landed in that window,
    // with no error anywhere to explain it. Failing loudly renders an error instead, and
    // unstable_cache caches nothing.
    const error = grantsError ?? defaultsError
    if (error) {
      console.error('[getDomainGrants] DB error:', error.message)
      throw new Error(`Could not resolve access grants: ${error.message}`)
    }

    return {
      grants: ((grants ?? []) as unknown) as { domain: string; level: string }[],
      defaults: ((defaults ?? []) as unknown) as { domain: string; level: string }[],
    }
  },
  ['domain-grants'],
  { tags: ['membership', 'domain-grants'], revalidate: 300 }
)
