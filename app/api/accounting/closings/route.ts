import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// lp_capital domain (lib/access/route-domains.ts). The middleware has already checked the caller's
// grant for this route + method; these resolve identity and keep the demo out of writes.
import { assertWriteAccess, assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { loadEntityNames } from '@/lib/accounting/load'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { dbError } from '@/lib/api-error'

/**
 * A vehicle's closings and who was admitted at each.
 *
 *   GET    ?group=            → closings for the vehicle, oldest first, each with its members;
 *                                plus the vehicle's partners not admitted at any close.
 *   POST   { name, closeDate, notes? }
 *   PATCH  { id, name?, closeDate?, notes?, members?: lpEntityId[] }
 *                              → `members` replaces the admitted set. An entity can be admitted at
 *                                one close per vehicle, so adding it here removes it from another.
 *   DELETE { id }             → the closing and its memberships. Commitments are untouched.
 */

const isoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)
  if (!vehicleId) return NextResponse.json({ closings: [], unassigned: [] })
  const a = admin as any

  const [{ data: closings, error }, names, { data: invs }] = await Promise.all([
    a.from('vehicle_closings').select('id, name, close_date, notes, vehicle_closing_members(lp_entity_id)')
      .eq('fund_id', gate.fundId).eq('vehicle_id', vehicleId).order('close_date', { ascending: true }),
    loadEntityNames(admin, gate.fundId, group),
    a.from('lp_investments').select('entity_id').eq('fund_id', gate.fundId).eq('portfolio_group', group),
  ])
  if (error) return dbError(error, 'accounting-closings')

  const admitted = new Set<string>()
  const out = ((closings ?? []) as any[]).map(c => {
    const members = ((c.vehicle_closing_members ?? []) as any[]).map(m => m.lp_entity_id as string)
    for (const m of members) admitted.add(m)
    return {
      id: c.id, name: c.name, closeDate: c.close_date, notes: c.notes ?? null,
      members: members.map(id => ({ lpEntityId: id, name: names.get(id) ?? id })).sort((x, y) => x.name.localeCompare(y.name)),
    }
  })
  const partnerIds = Array.from(new Set(((invs ?? []) as any[]).map(r => r.entity_id as string)))
  const unassigned = partnerIds.filter(id => !admitted.has(id)).map(id => ({ lpEntityId: id, name: names.get(id) ?? id })).sort((x, y) => x.name.localeCompare(y.name))

  return NextResponse.json({ closings: out, unassigned })
}

async function writeCtx(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return { error: gate }
  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return { error: group }
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)
  if (!vehicleId) return { error: NextResponse.json({ error: 'Vehicle not found' }, { status: 404 }) }
  return { error: undefined, admin: admin as any, fundId: gate.fundId as string, vehicleId, body }
}

export async function POST(req: NextRequest) {
  const c = await writeCtx(req)
  if (c.error) return c.error
  const { admin, fundId, vehicleId, body } = c
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : ''
  if (!name) return NextResponse.json({ error: 'A name is required' }, { status: 400 })
  if (!isoDate(body?.closeDate)) return NextResponse.json({ error: 'closeDate must be YYYY-MM-DD' }, { status: 400 })
  const notes = typeof body?.notes === 'string' ? body.notes.trim().slice(0, 2000) || null : null

  const { data, error } = await admin
    .from('vehicle_closings')
    .insert({ fund_id: fundId, vehicle_id: vehicleId, name, close_date: body.closeDate, notes })
    .select('id').single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A closing with that name already exists for this vehicle' }, { status: 409 })
    return dbError(error, 'accounting-closings')
  }
  return NextResponse.json({ ok: true, id: data.id })
}

export async function PATCH(req: NextRequest) {
  const c = await writeCtx(req)
  if (c.error) return c.error
  const { admin, fundId, vehicleId, body } = c
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { data: closing } = await admin.from('vehicle_closings').select('id').eq('id', id).eq('fund_id', fundId).eq('vehicle_id', vehicleId).maybeSingle()
  if (!closing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const update: Record<string, unknown> = {}
  if (body?.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
    if (!name) return NextResponse.json({ error: 'A name is required' }, { status: 400 })
    update.name = name
  }
  if (body?.closeDate !== undefined) {
    if (!isoDate(body.closeDate)) return NextResponse.json({ error: 'closeDate must be YYYY-MM-DD' }, { status: 400 })
    update.close_date = body.closeDate
  }
  if (body?.notes !== undefined) update.notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) || null : null
  if (Object.keys(update).length > 0) {
    update.updated_at = new Date().toISOString()
    const { error } = await admin.from('vehicle_closings').update(update).eq('id', id).eq('fund_id', fundId)
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'A closing with that name already exists for this vehicle' }, { status: 409 })
      return dbError(error, 'accounting-closings')
    }
  }

  if (Array.isArray(body?.members)) {
    const wanted: string[] = Array.from(new Set(body.members.filter((x: unknown): x is string => typeof x === 'string')))
    // Members must be this fund's entities — never trust the body's scope.
    const { data: ents } = wanted.length ? await admin.from('lp_entities').select('id').eq('fund_id', fundId).in('id', wanted) : { data: [] }
    const valid = new Set(((ents ?? []) as any[]).map(e => e.id as string))
    if (valid.size !== wanted.length) return NextResponse.json({ error: 'One or more partners are not in this fund' }, { status: 400 })

    // One admission per vehicle: drop these entities from the vehicle's other closings first.
    const { data: siblings } = await admin.from('vehicle_closings').select('id').eq('fund_id', fundId).eq('vehicle_id', vehicleId).neq('id', id)
    const siblingIds = ((siblings ?? []) as any[]).map(s => s.id as string)
    if (siblingIds.length && wanted.length) {
      await admin.from('vehicle_closing_members').delete().in('closing_id', siblingIds).in('lp_entity_id', wanted)
    }
    const { error: delErr } = await admin.from('vehicle_closing_members').delete().eq('closing_id', id)
    if (delErr) return dbError(delErr, 'accounting-closings')
    if (wanted.length) {
      const { error: insErr } = await admin.from('vehicle_closing_members').insert(wanted.map(lp_entity_id => ({ fund_id: fundId, closing_id: id, lp_entity_id })))
      if (insErr) return dbError(insErr, 'accounting-closings')
    }
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const c = await writeCtx(req)
  if (c.error) return c.error
  const { admin, fundId, vehicleId, body } = c
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const { error } = await admin.from('vehicle_closings').delete().eq('id', id).eq('fund_id', fundId).eq('vehicle_id', vehicleId)
  if (error) return dbError(error, 'accounting-closings')
  return NextResponse.json({ ok: true })
}
