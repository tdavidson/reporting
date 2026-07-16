import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts). The middleware has already checked the caller's
// grant for this route + method; these resolve identity and keep the demo out of writes.
import { assertWriteAccess, assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { listPeriods } from '@/lib/accounting/periods'
import { previewCloseThrough, closeThrough, reopenPeriodWithReversal, loadCloseEntries } from '@/lib/accounting/close'

// GET — list a vehicle's fiscal periods, or (?entriesFor=<periodId>) the allocation
// transactions a specific closed period posted.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const entriesFor = req.nextUrl.searchParams.get('entriesFor')
  if (entriesFor) return NextResponse.json(await loadCloseEntries(admin, gate.fundId, group, entriesFor))

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
  const gate = await assertWriteAccess(admin, user.id)
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
