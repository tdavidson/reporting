import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { lpStatement } from '@/lib/accounting/capital-calls'

// GET ?lp=<lpEntityId> — one LP's capital statement (summary + roll-forward + txns).
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const lp = req.nextUrl.searchParams.get('lp')
  if (!lp) return NextResponse.json({ error: 'lp is required' }, { status: 400 })

  const result = await lpStatement(admin, gate.fundId, group, lp)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 404 })
  return NextResponse.json(result)
}
