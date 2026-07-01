import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveLpAccess } from '@/lib/api-helpers'
import { buildOverview } from '@/lib/lp-overview'

/**
 * LP portal — the signed-in LP's portfolio overview: headline totals and a
 * per-vehicle breakdown, taken from the most recent snapshot that carries their
 * data. Scoped strictly to the investors resolveLpAccess grants, and only for
 * funds whose LP portal is switched on.
 */
export async function GET() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse) return access
  const { investorIds, lpAccountId } = access

  const { data: account } = await (admin as any)
    .from('lp_accounts').select('display_name').eq('id', lpAccountId).maybeSingle()
  const investorName = (account?.display_name as string | null) ?? null

  const empty = { investorName, currency: 'USD', hasData: false }
  if (investorIds.length === 0) return NextResponse.json(empty)

  // The LP's entities and the funds behind them.
  const { data: entities } = await (admin as any)
    .from('lp_entities').select('id, fund_id').in('investor_id', investorIds)
  const entityIds = Array.from(new Set(((entities ?? []) as any[]).map(e => e.id as string)))
  const fundIds = Array.from(new Set(((entities ?? []) as any[]).map(e => e.fund_id as string)))
  if (entityIds.length === 0 || fundIds.length === 0) return NextResponse.json(empty)

  // Only funds with the portal enabled expose figures; use the first one's currency.
  const { data: settings } = await (admin as any)
    .from('fund_settings').select('fund_id, lp_portal_enabled, currency').in('fund_id', fundIds)
  const enabledFundIds = ((settings ?? []) as any[]).filter(s => s.lp_portal_enabled).map(s => s.fund_id as string)
  if (enabledFundIds.length === 0) return NextResponse.json(empty)
  const currency = ((settings ?? []) as any[]).find(s => s.lp_portal_enabled)?.currency ?? 'USD'

  const { data: rows } = await (admin as any)
    .from('lp_investments')
    .select('portfolio_group, commitment, paid_in_capital, called_capital, distributions, nav, total_value, snapshot_id, lp_snapshots(id, name, as_of_date)')
    .in('entity_id', entityIds)
    .in('fund_id', enabledFundIds)

  const overview = buildOverview((rows ?? []) as any[])
  if (!overview) return NextResponse.json({ investorName, currency, hasData: false })

  return NextResponse.json({ investorName, currency, hasData: true, ...overview })
}
