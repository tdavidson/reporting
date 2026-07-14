import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { retagPortfolioGroup } from '@/lib/vehicles'

// Fund-wide investment-vehicle registry (fund_vehicles). Vehicles are used across
// LP snapshots, portfolio, compliance, and accounting — so management lives here,
// not under the optional Accounting section.

const KINDS = ['fund', 'spv', 'direct', 'associate', 'other']

// GET — all of the fund's vehicles (for the management UI).
export async function GET() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  // serves_vehicle_id / lp_entity_id may not exist until their migrations are pushed — fall back.
  let rows = await (admin as any)
    .from('fund_vehicles')
    .select('id, name, kind, aliases, active, serves_vehicle_id, lp_entity_id')
    .eq('fund_id', gate.fundId)
    .order('active', { ascending: false })
    .order('name')
  if (rows.error) {
    rows = await (admin as any)
      .from('fund_vehicles')
      .select('id, name, kind, aliases, active')
      .eq('fund_id', gate.fundId)
      .order('active', { ascending: false })
      .order('name')
  }
  if (rows.error) return NextResponse.json({ error: rows.error.message }, { status: 500 })
  return NextResponse.json(rows.data ?? [])
}

// POST — create a vehicle. { name, kind? }
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const kind = KINDS.includes(body.kind) ? body.kind : 'fund'
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const { data, error } = await (admin as any)
    .from('fund_vehicles')
    .insert({ fund_id: gate.fundId, name, kind, aliases: [], active: true })
    .select('id, name, kind, aliases, active')
    .single()
  if (error) {
    if ((error as any).code === '23505') return NextResponse.json({ error: 'A vehicle with that name already exists' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

// PATCH — update a vehicle. { id, name?, kind?, active? }
// Renaming cascades the string across every vehicle-scoped table (pre-Phase-2);
// the old name is kept as an alias so stray legacy rows still map back.
export async function PATCH(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { data: current } = await (admin as any)
    .from('fund_vehicles').select('id, name, aliases').eq('id', body.id).eq('fund_id', gate.fundId).maybeSingle()
  if (!current) return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 })

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.kind !== undefined) {
    if (!KINDS.includes(body.kind)) return NextResponse.json({ error: 'invalid kind' }, { status: 400 })
    update.kind = body.kind
  }
  if (body.active !== undefined) update.active = !!body.active
  // Link a GP/associate entity to the fund vehicle it serves (or clear it).
  if (body.servesVehicleId !== undefined) update.serves_vehicle_id = body.servesVehicleId || null

  // AND as WHOM it holds that position. The associates look-through needs both: which fund the
  // associate invests in, and which lp_entity on that fund's books represents it. Together
  // these replace the old free-text name matching, which broke silently on any rename.
  if (body.lpEntityId !== undefined) {
    const id = body.lpEntityId || null
    if (id) {
      const { data: ent } = await (admin as any)
        .from('lp_entities').select('id').eq('id', id).eq('fund_id', gate.fundId).maybeSingle()
      if (!ent) return NextResponse.json({ error: 'That partner is not in this fund.' }, { status: 400 })
    }
    update.lp_entity_id = id
  }

  if (typeof body.name === 'string' && body.name.trim() && body.name.trim() !== (current as any).name) {
    const newName = body.name.trim()
    const { data: clash } = await (admin as any)
      .from('fund_vehicles').select('id').eq('fund_id', gate.fundId).eq('name', newName).maybeSingle()
    if (clash) return NextResponse.json({ error: 'A vehicle with that name already exists' }, { status: 409 })

    // Rewrite the vehicle string across all the data, then keep the old name as an alias.
    await retagPortfolioGroup(admin, gate.fundId, (current as any).name, newName)
    update.name = newName
    update.aliases = Array.from(new Set([...(((current as any).aliases ?? []) as string[]), (current as any).name]))
  }

  const { data, error } = await (admin as any)
    .from('fund_vehicles')
    .update(update)
    .eq('id', body.id).eq('fund_id', gate.fundId)
    .select('id, name, kind, aliases, active')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
