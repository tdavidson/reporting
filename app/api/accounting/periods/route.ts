import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { listPeriods } from '@/lib/accounting/periods'
import { previewCloseThrough, closeThrough, reopenPeriodWithReversal } from '@/lib/accounting/close'

// GET — list a vehicle's fiscal periods.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  return NextResponse.json(await listPeriods(admin, gate.fundId, group))
}

// POST
//   { action: 'preview', endDate } → what closing THROUGH this date would allocate,
//                                     month by month (start is derived — no gaps)
//   { action: 'close',   endDate } → close every month through it, in order
//   { action: 'reopen',  id }      → void that period's allocation, unlock (newest first)
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  if (body?.action === 'preview') {
    const result = await previewCloseThrough(admin, gate.fundId, group, body?.endDate)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json(result)
  }

  if (body?.action === 'reopen') {
    if (!body?.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
    const result = await reopenPeriodWithReversal(admin, gate.fundId, group, body.id)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json(result)
  }

  const result = await closeThrough(admin, gate.fundId, group, user.id, body?.endDate)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, ...result })
}
