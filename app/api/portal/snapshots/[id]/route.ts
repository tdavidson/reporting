import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveLpAccess } from '@/lib/api-helpers'
import { logLpAccessEvent } from '@/lib/lp-access-log'

/**
 * LP portal — one shared snapshot, returning ONLY the signed-in LP's own
 * investor slice. Isolation is enforced in three steps:
 *   1. resolveLpAccess → the investor ids this user may see,
 *   2. the snapshot must be shared with at least one of those investors,
 *   3. investments are filtered to those investors' entities for this snapshot.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse) return access
  const { investorIds, lpAccountId } = access
  const snapshotId = params.id
  if (investorIds.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The snapshot must be shared with one of this LP's investors. The intersection
  // also tells us exactly which investors' data this user may see here.
  const { data: shares } = await (admin as any)
    .from('lp_snapshot_shares')
    .select('lp_investor_id, fund_id')
    .eq('snapshot_id', snapshotId)
    .in('lp_investor_id', investorIds)
  const sharedInvestorIds = Array.from(new Set((shares ?? []).map((s: any) => s.lp_investor_id as string)))
  if (sharedInvestorIds.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The fund's LP portal must be switched on for the snapshot to be visible.
  // A share row always carries fund_id; treat its absence as "not found" rather
  // than silently skipping the gate.
  const fundId = (shares ?? [])[0]?.fund_id as string | undefined
  if (!fundId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data: ef } = await (admin as any).from('fund_settings').select('lp_portal_enabled').eq('fund_id', fundId).maybeSingle()
  if (!ef?.lp_portal_enabled) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: snapshot } = await (admin as any)
    .from('lp_snapshots')
    .select('id, name, as_of_date, description, footer_note')
    .eq('id', snapshotId)
    .maybeSingle()
  if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: entities } = await (admin as any)
    .from('lp_entities')
    .select('id, entity_name, investor_id, lp_investors(id, name)')
    .in('investor_id', sharedInvestorIds)
  const entityById = new Map<string, any>((entities ?? []).map((e: any) => [e.id, e]))
  const entityIds = Array.from(entityById.keys())

  const { data: investments } = await (admin as any)
    .from('lp_investments')
    .select('id, entity_id, portfolio_group, commitment, total_value, nav, called_capital, paid_in_capital, distributions, outstanding_balance, dpi, rvpi, tvpi, irr')
    .eq('snapshot_id', snapshotId)
    .in('entity_id', entityIds.length ? entityIds : ['00000000-0000-0000-0000-000000000000'])

  const enriched = (investments ?? []).map((inv: any) => ({ ...inv, lp_entities: entityById.get(inv.entity_id) ?? null }))

  await logLpAccessEvent(admin, {
    fundId,
    lpAccountId,
    authUserId: user.id,
    lpInvestorId: (sharedInvestorIds[0] as string | undefined) ?? null,
    eventType: 'view',
    targetType: 'snapshot',
    targetId: snapshotId,
    targetTitle: snapshot.name,
    metadata: { investor_ids: sharedInvestorIds },
  })

  return NextResponse.json({ snapshot, investments: enriched })
}
