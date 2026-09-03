import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveLpAccess } from '@/lib/api-helpers'
import { resolveLpHousehold } from '@/lib/lp-access-log'

/**
 * LP portal — access history for one shared item, across the signed-in LP's own
 * household (themselves + any authorized users delegated for the same investors).
 * Never exposes another LP's activity. The caller must have access to the target,
 * verified with the same share checks the item's own routes use.
 *
 * GET /api/portal/access-history?type=snapshot|letter|document&id=<uuid>
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const type = req.nextUrl.searchParams.get('type')
  const id = req.nextUrl.searchParams.get('id')
  if (!id || (type !== 'snapshot' && type !== 'letter' && type !== 'document')) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse) return access
  const { investorIds } = access
  if (investorIds.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Verify the caller can actually see this target (mirrors the item routes).
  let fundId: string | undefined
  if (type === 'snapshot') {
    const { data: shares } = await (admin as any)
      .from('lp_snapshot_shares').select('fund_id').eq('snapshot_id', id).in('lp_investor_id', investorIds).limit(1)
    fundId = (shares ?? [])[0]?.fund_id
  } else if (type === 'letter') {
    const { data: shares } = await (admin as any)
      .from('lp_letter_shares').select('fund_id').eq('letter_id', id).in('lp_investor_id', investorIds).limit(1)
    fundId = (shares ?? [])[0]?.fund_id
  } else {
    const { data: doc } = await (admin as any)
      .from('lp_documents').select('fund_id, scope, storage_path').eq('id', id).maybeSingle()
    if (doc && !String(doc.storage_path ?? '').startsWith('sample/')) {
      if (doc.scope === 'fund') {
        const { data: inv } = await (admin as any).from('lp_investors').select('id').eq('fund_id', doc.fund_id).in('id', investorIds).limit(1)
        if ((inv ?? []).length > 0) fundId = doc.fund_id
      } else {
        const { data: share } = await (admin as any).from('lp_document_shares').select('id').eq('document_id', id).in('lp_investor_id', investorIds).limit(1)
        if ((share ?? []).length > 0) fundId = doc.fund_id
      }
    }
  }
  if (!fundId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The portal must be on for this fund.
  const { data: ef } = await (admin as any).from('fund_settings').select('lp_portal_enabled').eq('fund_id', fundId).maybeSingle()
  if (!ef?.lp_portal_enabled) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { accountIds, accounts } = await resolveLpHousehold(admin, investorIds)
  if (accountIds.length === 0) return NextResponse.json({ events: [] })

  const { data: rows } = await (admin as any)
    .from('lp_access_events')
    .select('id, created_at, event_type, lp_account_id')
    .eq('fund_id', fundId)
    .eq('target_type', type)
    .eq('target_id', id)
    .in('event_type', ['view', 'download'])
    .in('lp_account_id', accountIds)
    .order('created_at', { ascending: false })
    .limit(200)

  const myAccountId = access.lpAccountId
  const events = ((rows ?? []) as any[]).map(r => {
    const acct = r.lp_account_id ? accounts.get(r.lp_account_id) : undefined
    return {
      id: r.id,
      createdAt: r.created_at,
      eventType: r.event_type,
      personName: acct?.displayName ?? acct?.email ?? 'Someone',
      personKind: acct?.kind ?? null,
      isYou: r.lp_account_id === myAccountId,
    }
  })

  return NextResponse.json({ events })
}
