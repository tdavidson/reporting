import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts). The middleware has already checked the caller's
// grant for this route + method; these resolve identity and keep the demo out of writes.
import { assertWriteAccess, assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { bookCapitalCallFromInflow, bookDistributionFromOutflow, linkInflowToEntry, capitalCallCandidates } from '@/lib/accounting/bank-match'

// GET — capital-call entries an inflow can be matched to (unlinked, with amount).
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  return NextResponse.json(await capitalCallCandidates(admin, gate.fundId, group))
}

// POST — match a bank transaction to LP capital.
//   { id, mode: 'allocate' | 'link' | 'distribute', entryId?, lpEntityId?, perLp?, group? }
//
// 'distribute' is the outflow counterpart to 'allocate'. Without it, the only way to book a
// distribution was the bank categorizer's rule, which posts to the POOLED capital account
// with no lp_entity_id — money leaves the fund and no LP's capital account, statement, or
// roll-forward ever records receiving it.
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const { id, mode, entryId, lpEntityId, perLp, group: bodyGroup } = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, bodyGroup ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  if (mode === 'link') {
    if (!entryId) return NextResponse.json({ error: 'entryId is required to link' }, { status: 400 })
    const result = await linkInflowToEntry(admin, gate.fundId, group, id, entryId)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json(result)
  }

  if (mode === 'distribute') {
    // `perLp` is an optional { lpEntityId: amount } map — what a waterfall would hand us.
    // Omitted, the outflow splits by ending capital balance.
    const override = perLp && typeof perLp === 'object'
      ? new Map<string, number>(Object.entries(perLp).map(([k, v]) => [k, Number(v)]))
      : null
    const result = await bookDistributionFromOutflow(admin, gate.fundId, group, user.id, id, override)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true, ...result })
  }

  const result = await bookCapitalCallFromInflow(admin, gate.fundId, group, user.id, id, lpEntityId ?? null)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, ...result })
}
