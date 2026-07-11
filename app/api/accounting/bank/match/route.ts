import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { bookCapitalCallFromInflow, linkInflowToEntry, capitalCallCandidates } from '@/lib/accounting/bank-match'

// GET — capital-call entries an inflow can be matched to (unlinked, with amount).
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  return NextResponse.json(await capitalCallCandidates(admin, gate.fundId, group))
}

// POST — match an inflow to a capital call. { id, mode: 'allocate'|'link', entryId?, group? }
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const { id, mode, entryId, lpEntityId, group: bodyGroup } = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, bodyGroup ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  if (mode === 'link') {
    if (!entryId) return NextResponse.json({ error: 'entryId is required to link' }, { status: 400 })
    const result = await linkInflowToEntry(admin, gate.fundId, group, id, entryId)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json(result)
  }

  const result = await bookCapitalCallFromInflow(admin, gate.fundId, group, user.id, id, lpEntityId ?? null)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, ...result })
}
