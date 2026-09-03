import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AffinityClient, AffinityError } from '@/lib/affinity/client'
import { getAffinityKey, markAffinityKeyError, markAffinityKeyOk } from '@/lib/affinity/credentials'
import { dbError } from '@/lib/api-error'

/**
 * Link a diligence deal to an Affinity organization.
 *
 * GET  ?search=<term>  — search Affinity orgs to pick from (uses the caller's key)
 * GET                  — current link status for the deal
 * POST { organization_id, opportunity_id? } — link it
 * DELETE               — unlink (imported documents stay; they're evidence)
 *
 * The linking user is recorded in `affinity_linked_by`: the background sync runs
 * as them, so what it can see is exactly what that real person can see.
 */

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const guard = await ensureDeal(params.id)
  if ('error' in guard) return guard.error
  const { admin, fundId, userId, deal } = guard

  const term = req.nextUrl.searchParams.get('search')

  if (term !== null) {
    const apiKey = await getAffinityKey(admin, userId)
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Connect your Affinity account in Settings first.', needs_connection: true },
        { status: 400 }
      )
    }
    if (!term.trim()) return NextResponse.json({ organizations: [] })

    try {
      const orgs = await new AffinityClient(apiKey).searchOrganizations(term.trim())
      await markAffinityKeyOk(admin, userId)
      return NextResponse.json({ organizations: orgs })
    } catch (err) {
      const message = err instanceof AffinityError ? err.message : 'Affinity search failed'
      if (err instanceof AffinityError && err.status === 401) {
        await markAffinityKeyError(admin, userId, message)
      }
      return NextResponse.json({ error: message }, { status: 502 })
    }
  }

  // Link status. Also report whether the *caller* can sync — the deal may be
  // linked by a colleague whose key the caller can't use.
  const linkedBy = (deal as any).affinity_linked_by as string | null
  const callerKey = await getAffinityKey(admin, userId)

  let linkerHasKey = false
  if (linkedBy) {
    const { data } = await (admin as any)
      .from('affinity_credentials')
      .select('user_id')
      .eq('user_id', linkedBy)
      .maybeSingle()
    linkerHasKey = !!data
  }

  return NextResponse.json({
    linked: !!(deal as any).affinity_organization_id,
    organization_id: (deal as any).affinity_organization_id ?? null,
    opportunity_id: (deal as any).affinity_opportunity_id ?? null,
    linked_by: linkedBy,
    last_synced_at: (deal as any).affinity_last_synced_at ?? null,
    caller_connected: !!callerKey,
    // When false, the sync has no usable key — surface "sync paused, reconnect".
    sync_active: !!(deal as any).affinity_organization_id && linkerHasKey,
  })
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const guard = await ensureDeal(params.id)
  if ('error' in guard) return guard.error
  const { admin, fundId, userId } = guard

  const body = await req.json().catch(() => ({}))
  const organizationId = Number(body.organization_id)
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return NextResponse.json({ error: 'organization_id is required' }, { status: 400 })
  }
  const opportunityId = Number.isFinite(Number(body.opportunity_id))
    ? Number(body.opportunity_id)
    : null

  const apiKey = await getAffinityKey(admin, userId)
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Connect your Affinity account in Settings first.', needs_connection: true },
      { status: 400 }
    )
  }

  // Confirm the org actually exists and this key can see it, so we never store a
  // link the sync can't follow.
  try {
    await new AffinityClient(apiKey).getOrganization(organizationId)
    await markAffinityKeyOk(admin, userId)
  } catch (err) {
    const message = err instanceof AffinityError ? err.message : 'Affinity lookup failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  const { error } = await admin
    .from('diligence_deals')
    .update({
      affinity_organization_id: organizationId,
      affinity_opportunity_id: opportunityId,
      affinity_linked_by: userId,
    } as any)
    .eq('id', params.id)
    .eq('fund_id', fundId)

  if (error) return dbError(error, 'diligence-affinity-link')

  return NextResponse.json({
    linked: true,
    organization_id: organizationId,
    opportunity_id: opportunityId,
  })
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const guard = await ensureDeal(params.id)
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  // Documents already imported are left in place on purpose: they're evidence
  // the memo may already cite, and deleting cited evidence would silently break
  // the provenance chain.
  const { error } = await admin
    .from('diligence_deals')
    .update({
      affinity_organization_id: null,
      affinity_opportunity_id: null,
      affinity_linked_by: null,
    } as any)
    .eq('id', params.id)
    .eq('fund_id', fundId)

  if (error) return dbError(error, 'diligence-affinity-unlink')
  return NextResponse.json({ linked: false })
}

async function ensureDeal(dealId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return { error: NextResponse.json({ error: 'No fund found' }, { status: 403 }) }
  const fundId = (membership as any).fund_id as string

  const { data: deal } = await admin
    .from('diligence_deals')
    .select('id, name, affinity_organization_id, affinity_opportunity_id, affinity_linked_by, affinity_last_synced_at')
    .eq('id', dealId)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!deal) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }

  return { admin, fundId, userId: user.id, deal }
}
