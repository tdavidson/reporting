import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts). The middleware has already checked the grant.
import { assertWriteAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { autoMatchOpenCapital } from '@/lib/accounting/bank-auto-match-run'

export const runtime = 'nodejs'

// POST — settle drafted bank transactions against DECLARED capital calls (1300) and
// distributions (2300), inferring the partner from the amount and the wire description.
// Body: { ids?: string[] } — omit for every drafted row in the vehicle.
//
// Writes drafts only. Returns { matched, ambiguous, unmatched }; `ambiguous` carries the
// candidate partners so the bank page can ask rather than guess.
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const result = await autoMatchOpenCapital(
    admin, gate.fundId, group, user.id,
    Array.isArray(body?.ids) ? body.ids : undefined,
  )
  if ('error' in result) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
