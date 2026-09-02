import { createAdminClient } from '@/lib/supabase/admin'
import { accessMap, effectiveAccess } from '@/lib/access/effective'
import { domainForFeature } from '@/lib/access/domains'
import { DEFAULT_FEATURE_VISIBILITY, type FeatureKey } from '@/lib/types/features'
import { API_VERSION, SERVER_VERSION } from '@/lib/api-v1/constants'
import { resolveV1Principal, V1PrincipalError } from '@/lib/api-v1/principal'
import { requestId, v1Error, v1Json } from '@/lib/api-v1/response'

// Authenticated and per-request by construction: it reads the caller's bearer token. Saying so
// explicitly keeps `next build` from probing it as a static route and logging the bailout.
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const id = requestId()
  const admin = createAdminClient()
  try {
    const principal = await resolveV1Principal(admin, req)
    const [{ data: member, error: memberError }, { data: fund, error: fundError }] = await Promise.all([
      admin.from('fund_members').select('display_name').eq('fund_id', principal.fundId).eq('user_id', principal.userId).maybeSingle(),
      admin.from('funds').select('name').eq('id', principal.fundId).maybeSingle(),
    ])
    if (memberError) throw new Error(memberError.message)
    if (fundError) throw new Error(fundError.message)
    if (!fund) return v1Error('FUND_NOT_FOUND', 'Fund not found.', 404, id)

    const enabledFeatures = (Object.keys(DEFAULT_FEATURE_VISIBILITY) as FeatureKey[]).filter(feature => {
      const domain = domainForFeature(feature)
      return domain ? effectiveAccess(principal.access, domain, feature) !== 'none' : false
    })
    const availableAnalystScopes = [
      effectiveAccess(principal.access, 'portfolio') !== 'none' ? 'portfolio' : null,
      effectiveAccess(principal.access, 'accounting') !== 'none' ? 'funds' : null,
      effectiveAccess(principal.access, 'accounting') !== 'none' ? 'accounting' : null,
      effectiveAccess(principal.access, 'lp_capital') !== 'none' ? 'lps' : null,
      effectiveAccess(principal.access, 'diligence') !== 'none' ? 'diligence' : null,
    ].filter((value): value is string => value !== null)

    return v1Json({
      user: { id: principal.userId, displayName: member?.display_name ?? null },
      fund: { id: principal.fundId, name: fund.name },
      role: principal.role,
      access: accessMap(principal.access),
      enabledFeatures,
      availableAnalystScopes,
      serverVersion: SERVER_VERSION,
      apiVersion: API_VERSION,
    }, { requestId: id })
  } catch (error) {
    if (error instanceof V1PrincipalError) return v1Error(error.code, error.message, error.status, id)
    console.error(`[api-v1] ${id} GET /me failed`, error)
    return v1Error('INTERNAL_ERROR', 'The request could not be completed.', 500, id)
  }
}

