import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { issueCapitalCall, proRataCall, lpCapitalSummary, listCapitalCalls } from '@/lib/accounting/capital-calls'

// GET — the per-LP capital summary (commitment/called/funded/outstanding) plus
// the issued-call history for the vehicle.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const [summary, calls] = await Promise.all([
    lpCapitalSummary(admin, gate.fundId, group),
    listCapitalCalls(admin, gate.fundId, group),
  ])
  return NextResponse.json({ summary, calls })
}

// POST — { action: 'preview' | 'issue', ... }
//   preview: { total } → per-LP pro-rata split by commitment (to edit before issuing)
//   issue:   { callDate, description, scope, lines: [{ lpEntityId, amount }] }
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
    const total = Number(body?.total)
    if (!Number.isFinite(total) || total <= 0) return NextResponse.json({ error: 'A positive total is required' }, { status: 400 })
    return NextResponse.json({ lines: await proRataCall(admin, gate.fundId, group, total) })
  }

  if (body?.action === 'issue') {
    const result = await issueCapitalCall(admin, gate.fundId, group, user.id, {
      callDate: String(body?.callDate ?? ''),
      description: body?.description ?? null,
      scope: body?.scope === 'per_lp' ? 'per_lp' : 'fund_wide',
      lines: Array.isArray(body?.lines) ? body.lines : [],
    })
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json(result)
  }

  return NextResponse.json({ error: "action must be 'preview' or 'issue'" }, { status: 400 })
}
