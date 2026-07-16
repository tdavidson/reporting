// LP capital events — the LP-facing capital movements of a vehicle with no double-entry books.
//
//   GET    ?group=X            list this vehicle's events + its capital source + LP roster
//   POST   ?group=X            create one or many events
//   PUT    ?group=X            edit one event
//   DELETE ?group=X&id=...     remove one event
//   PATCH  ?group=X            change the vehicle's capital_source (ledger <-> events)
//
// The API speaks `capitalDelta` (positive = the LP's capital goes up). The debit-positive
// storage convention never leaves lib/accounting/lp-events.ts.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbError } from '@/lib/api-error'
// lp_capital domain (lib/access/route-domains.ts). The middleware has already checked the caller's
// grant for this route + method; these resolve identity and keep the demo out of writes.
import { assertWriteAccess, assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { loadEntityNames } from '@/lib/accounting/load'
import { loadCapitalSource } from '@/lib/accounting/capital-source'
import {
  resolveScope, listEvents, createEvents, updateEvent, deleteEvent,
  LP_EVENT_TYPES, type LpCapitalEventInput,
} from '@/lib/accounting/lp-events'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'

async function scopeOr400(admin: any, fundId: string, group: string) {
  const scope = await resolveScope(admin, fundId, group)
  if ('error' in scope) return NextResponse.json({ error: scope.error }, { status: 400 })
  return scope
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const scope = await scopeOr400(admin, gate.fundId, group)
  if (scope instanceof NextResponse) return scope

  const [events, source, names] = await Promise.all([
    listEvents(admin, scope),
    loadCapitalSource(admin, gate.fundId, group),
    loadEntityNames(admin, gate.fundId, group),
  ])

  // The LP roster the importer and the manual form pick from. Falls back to the fund's whole
  // entity list when the vehicle has no commitments recorded yet — otherwise a brand-new SPV
  // would offer no LPs to enter events against, which is exactly when you need them.
  let roster = Array.from(names.entries()).map(([id, name]) => ({ id, name }))
  if (roster.length === 0) {
    const { data } = await admin
      .from('lp_entities' as any)
      .select('id, entity_name')
      .eq('fund_id', gate.fundId)
      .order('entity_name')
    roster = ((data as any[]) ?? []).map(r => ({ id: r.id, name: r.entity_name }))
  }

  return NextResponse.json({ group, source, events, roster, types: LP_EVENT_TYPES })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const scope = await scopeOr400(admin, gate.fundId, group)
  if (scope instanceof NextResponse) return scope

  const body = await req.json().catch(() => null)
  const events: LpCapitalEventInput[] = Array.isArray(body?.events)
    ? body.events
    : body?.event ? [body.event] : []
  if (events.length === 0) return NextResponse.json({ error: 'No events supplied.' }, { status: 400 })

  const result = await createEvents(admin, scope, events, user.id)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result)
}

export async function PUT(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const scope = await scopeOr400(admin, gate.fundId, group)
  if (scope instanceof NextResponse) return scope

  const body = await req.json().catch(() => null)
  if (!body?.id || !body?.event) return NextResponse.json({ error: 'id and event are required.' }, { status: 400 })

  const result = await updateEvent(admin, scope, body.id, body.event)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result)
}

export async function DELETE(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const scope = await scopeOr400(admin, gate.fundId, group)
  if (scope instanceof NextResponse) return scope

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 })

  const result = await deleteEvent(admin, scope, id)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result)
}

// PATCH — switch which producer this vehicle's LP capital comes from.
export async function PATCH(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const body = await req.json().catch(() => null)
  const next = body?.capitalSource
  if (next !== 'ledger' && next !== 'events') {
    return NextResponse.json({ error: 'capitalSource must be "ledger" or "events".' }, { status: 400 })
  }

  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)
  if (!vehicleId) return NextResponse.json({ error: `Unknown vehicle "${group}".` }, { status: 400 })

  // GUARD: promoting to 'ledger' on a vehicle with no chart of accounts would make its LP
  // capital read as zero everywhere — the report would quietly lose every LP in it. Books
  // first, then flip.
  if (next === 'ledger') {
    const { count } = await admin
      .from('chart_of_accounts' as any)
      .select('id', { count: 'exact', head: true })
      .eq('fund_id', gate.fundId)
      .eq('vehicle_id', vehicleId)
    if (!count) {
      return NextResponse.json({
        error: `"${group}" has no chart of accounts, so reading its capital from the ledger would report zero for every LP. Seed the chart and book its history first.`,
      }, { status: 400 })
    }
  }

  const { error } = await admin
    .from('vehicle_accounting_settings' as any)
    .upsert(
      { fund_id: gate.fundId, vehicle_id: vehicleId, capital_source: next, updated_at: new Date().toISOString() },
      { onConflict: 'fund_id,vehicle_id' }
    )
  if (error) return dbError(error, 'accounting-lp-events')

  return NextResponse.json({ ok: true, capitalSource: next })
}
