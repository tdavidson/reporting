import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts). The middleware has already checked the caller's
// grant for this route + method; this resolves identity and keeps the demo out of writes.
import { assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { fundTimeseries } from '@/lib/accounting/fund-timeseries'

// GET — whole-fund growth over time for one vehicle: the quarterly cumulative series behind the
// fund detail page's growth and NAV-composition charts. Whole-fund, so no gp_economics carve-out
// is needed — the carry/transfer reallocations net to zero across every partner.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const asOf = req.nextUrl.searchParams.get('asOf') ?? undefined
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return NextResponse.json({ error: 'asOf must be YYYY-MM-DD' }, { status: 400 })
  }

  try {
    const series = await fundTimeseries(admin, gate.fundId, group, asOf)
    return NextResponse.json(series)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
