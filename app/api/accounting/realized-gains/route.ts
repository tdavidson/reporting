import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts). Read-only.
import { assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { loadRealizedGains } from '@/lib/accounting/realized-gains-load'

// GET ?group=&year=YYYY (or ?start=&end=) — realized gains by lot for the window: each disposal,
// the lots it consumed under the fund's lot method, proceeds and gain per lot, and the holding
// period. The Schedule D / Form 8949 input; also what the K-1's box 8 and 9a reconcile to.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const sp = req.nextUrl.searchParams
  const group = await resolveGroupOr400(admin, gate, sp.get('group'))
  if (group instanceof NextResponse) return group

  const year = parseInt(sp.get('year') ?? '', 10)
  const period = Number.isInteger(year)
    ? { start: `${year}-01-01`, end: `${year}-12-31` }
    : { start: sp.get('start'), end: sp.get('end') }

  return NextResponse.json(await loadRealizedGains(admin, gate.fundId, group, period))
}
