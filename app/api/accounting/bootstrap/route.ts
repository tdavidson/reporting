import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts). The middleware has already checked the caller's
// grant for this route + method; this resolves identity and keeps the demo out of writes.
import { assertWriteAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { bootstrapOpeningBalances } from '@/lib/accounting/bootstrap'

// POST — cutover bootstrap: generate the opening position for a vehicle from the
// LP data already in the platform (paid-in − distributions per LP), as of a date.
// Seeds the chart first if empty. Body: { entryDate, group? }
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
  const entryDate: string = body?.entryDate
  if (!entryDate) return NextResponse.json({ error: 'entryDate is required' }, { status: 400 })

  const result = await bootstrapOpeningBalances(admin, gate.fundId, group, user.id, entryDate)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result)
}
