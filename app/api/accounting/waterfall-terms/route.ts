// A vehicle's carry terms — what the close accrues carried interest on.
//
//   GET  ?group=X   the vehicle's terms + the partners who could receive the carry
//   PUT  ?group=X   set them
//
// Absent terms mean NO CARRY, and that is the only safe default: accruing carry nobody agreed
// to is worse than accruing none at all.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess, assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { loadCarryTerms } from '@/lib/accounting/carry'
import { loadEntityNames } from '@/lib/accounting/load'
import { dbError } from '@/lib/api-error'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const [terms, names] = await Promise.all([
    loadCarryTerms(admin, gate.fundId, group),
    loadEntityNames(admin, gate.fundId, group),
  ])

  // Whoever could receive the carry. Normally the GP entity, but we don't force that — some
  // structures accrue it to a named associate vehicle's entity instead.
  const { data: entities } = await admin
    .from('lp_entities' as any)
    .select('id, entity_name, partner_class')
    .eq('fund_id', gate.fundId)
    .order('entity_name')

  return NextResponse.json({
    group,
    terms,
    partners: Array.from(names.entries()).map(([id, name]) => ({ lpEntityId: id, name })),
    candidates: ((entities as any[]) ?? []).map(e => ({
      lpEntityId: e.id,
      name: e.entity_name,
      partnerClass: e.partner_class ?? 'lp',
    })),
  })
}

export async function PUT(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)
  if (!vehicleId) return NextResponse.json({ error: `Unknown vehicle "${group}".` }, { status: 400 })

  const kind = body?.kind
  if (!['none', 'straight', 'american', 'european'].includes(kind)) {
    return NextResponse.json({ error: 'kind must be none, straight, american, or european.' }, { status: 400 })
  }

  const num = (v: any, fallback = 0) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  const carryRate = num(body?.carryRate)
  const prefRate = num(body?.prefRate)
  const catchupRate = num(body?.catchupRate, 1)

  if (carryRate < 0 || carryRate >= 1) {
    return NextResponse.json({ error: 'Carry rate must be a fraction between 0 and 1 (0.2 = 20%).' }, { status: 400 })
  }
  if (prefRate < 0 || prefRate >= 1) {
    return NextResponse.json({ error: 'Preferred return must be a fraction between 0 and 1 (0.08 = 8%).' }, { status: 400 })
  }
  if (catchupRate < 0 || catchupRate > 1) {
    return NextResponse.json({ error: 'Catch-up rate must be between 0 and 1.' }, { status: 400 })
  }

  // Carry has to accrue TO somebody. Without a recipient the close would compute an accrual it
  // cannot post — better to refuse here than to fail mid-close.
  const gpEntityId = body?.gpEntityId || null
  if (kind !== 'none' && carryRate > 0 && !gpEntityId) {
    return NextResponse.json({ error: 'Choose the partner who receives the carry.' }, { status: 400 })
  }
  if (gpEntityId) {
    const { data: ent } = await admin
      .from('lp_entities' as any)
      .select('id')
      .eq('id', gpEntityId)
      .eq('fund_id', gate.fundId)
      .maybeSingle()
    if (!ent) return NextResponse.json({ error: 'That partner is not in this fund.' }, { status: 400 })
  }

  const { error } = await admin
    .from('vehicle_waterfall_terms' as any)
    .upsert(
      {
        fund_id: gate.fundId,
        vehicle_id: vehicleId,
        kind,
        carry_rate: carryRate,
        pref_rate: prefRate,
        catchup_rate: catchupRate,
        pref_compounds: body?.prefCompounds !== false,
        gp_entity_id: gpEntityId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'fund_id,vehicle_id' }
    )
  if (error) return dbError(error, 'waterfall-terms-put')

  return NextResponse.json({ ok: true })
}
