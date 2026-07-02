import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { bookCapitalCallFromInflow, linkInflowToEntry, capitalCallCandidates } from '@/lib/accounting/bank-match'

// GET — capital-call entries an inflow can be matched to (unlinked, with amount).
export async function GET() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  return NextResponse.json(await capitalCallCandidates(admin, gate.fundId))
}

// POST — match an inflow to a capital call.
//   { id, mode: 'allocate' }            → per-LP allocated call replaces the draft
//   { id, mode: 'link', entryId }       → link to an existing recorded call
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const { id, mode, entryId } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  if (mode === 'link') {
    if (!entryId) return NextResponse.json({ error: 'entryId is required to link' }, { status: 400 })
    const result = await linkInflowToEntry(admin, gate.fundId, id, entryId)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json(result)
  }

  const result = await bookCapitalCallFromInflow(admin, gate.fundId, user.id, id)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, ...result })
}
