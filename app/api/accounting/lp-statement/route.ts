import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { lpStatement } from '@/lib/accounting/capital-calls'
import { resolvePeriod, customPeriod, type PeriodPreset } from '@/lib/accounting/statement-period'

// GET ?lp=<lpEntityId> — one LP's capital statement (summary + roll-forward + txns).
// Optional ?preset= / ?start=&end= scopes the period roll-forward; the inception-to-date
// roll-forward is always returned alongside it.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const sp = req.nextUrl.searchParams
  const lp = sp.get('lp')
  if (!lp) return NextResponse.json({ error: 'lp is required' }, { status: 400 })

  const preset = sp.get('preset') as PeriodPreset | null
  const period = preset && preset !== 'custom'
    ? resolvePeriod(preset)
    : customPeriod(sp.get('start'), sp.get('end'))

  const result = await lpStatement(admin, gate.fundId, group, lp, period)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 404 })
  return NextResponse.json({ ...result, period })
}
