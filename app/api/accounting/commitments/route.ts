import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// lp_capital domain (lib/access/route-domains.ts). The middleware has already checked the caller's
// grant for this route + method; these resolve identity and keep the demo out of writes.
import { assertWriteAccess, assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { loadEntityNames } from '@/lib/accounting/load'
import { loadCommitmentEvents, commitmentsAsOf, recordCommitmentChange } from '@/lib/accounting/terms'

// GET ?asOf=YYYY-MM-DD — commitment history, plus each partner's commitment as of a date.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const asOf = req.nextUrl.searchParams.get('asOf')
  const [events, names] = await Promise.all([
    loadCommitmentEvents(admin, gate.fundId, group),
    loadEntityNames(admin, gate.fundId, group),
  ])

  const commitments = commitmentsAsOf(events, asOf)
  return NextResponse.json({
    asOf: asOf ?? null,
    partners: Array.from(commitments.entries())
      .map(([lpEntityId, commitment]) => ({ lpEntityId, name: names.get(lpEntityId) ?? lpEntityId, commitment }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    events: events
      .map(e => ({ ...e, name: names.get(e.lpEntityId) ?? e.lpEntityId }))
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate)),
  })
}

// POST — record a commitment change.
//   { lpEntityId, effectiveDate, amount }                            → increase/decrease
//   { lpEntityId, effectiveDate, amount, counterpartyEntityId }      → TRANSFER of
//     commitment from the counterparty to lpEntityId (both legs written atomically).
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

  const result = await recordCommitmentChange(admin, gate.fundId, group, user.id, {
    lpEntityId: body?.lpEntityId,
    effectiveDate: body?.effectiveDate,
    amount: Number(body?.amount),
    counterpartyEntityId: body?.counterpartyEntityId ?? null,
    memo: body?.memo ?? null,
  })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
