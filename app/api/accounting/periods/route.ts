import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts). The middleware has already checked the caller's
// grant for this route + method; these resolve identity and keep the demo out of writes.
import { assertWriteAccess, assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { listPeriods } from '@/lib/accounting/periods'
import { previewCloseThrough, closeThrough, reopenThrough, loadCloseEntries, nextCloseStart } from '@/lib/accounting/close'

// GET — { periods, nextStart }: a vehicle's fiscal periods plus where the next close would
// start (the page derives the still-open months from it), or (?entriesFor=<periodId>) the
// allocation transactions a specific closed period posted.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const entriesFor = req.nextUrl.searchParams.get('entriesFor')
  if (entriesFor) return NextResponse.json(await loadCloseEntries(admin, gate.fundId, group, entriesFor))

  const [periods, nextStart] = await Promise.all([
    listPeriods(admin, gate.fundId, group),
    nextCloseStart(admin, gate.fundId, group),
  ])
  return NextResponse.json({ periods, nextStart })
}

// POST
//   { action: 'preview', endDate } → what closing THROUGH this date would allocate,
//                                     month by month (start is derived — no gaps)
//   { action: 'close',   endDate } → close every month through it, in order
//   { action: 'reopen',  id }      → reopen that period and every closed period after it,
//                                     newest-first, voiding each one's allocation
//   { action: 'reopen',  fromDate } → same, for every closed period covering or after the date
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  if (body?.action === 'preview') {
    const result = await previewCloseThrough(admin, gate.fundId, group, body?.endDate)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json(result)
  }

  if (body?.action === 'reopen') {
    if (!body?.id && !body?.fromDate) return NextResponse.json({ error: 'id or fromDate is required' }, { status: 400 })
    const result = await reopenThrough(admin, gate.fundId, group, body.id ? { periodId: String(body.id) } : { fromDate: String(body.fromDate) })
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json(result)
  }

  const result = await closeThrough(admin, gate.fundId, group, user.id, body?.endDate)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, ...result })
}
