import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// management_company domain (lib/access/route-domains.ts). The middleware has already checked the
// caller's grant for this route + method; these resolve identity and keep the demo out of writes.
import { assertReadAccess, assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { listMancoVehicles } from '@/lib/accounting/load'
import { chartForVehicleKind } from '@/lib/accounting/chart'
import { MANCO_KIND } from '@/lib/vehicle-kinds'

// GET — the fund's management companies, with enough state for the section's landing page to
// distinguish "not set up yet" from "set up and empty".
export async function GET() {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const vehicles = await listMancoVehicles(admin, gate.fundId)
  if (vehicles.length === 0) return NextResponse.json([])

  // "Is the chart seeded" decides whether the landing page offers Set up or Open, and it is one
  // query for all of them rather than one each — a firm can run half a dozen management entities
  // (one per fund family, one per jurisdiction) and N+1 on a landing page is how that gets slow.
  const expected = chartForVehicleKind(MANCO_KIND).length
  const { data: accounts } = await admin
    .from('chart_of_accounts' as any)
    .select('vehicle_id')
    .eq('fund_id', gate.fundId)
    .in('vehicle_id', vehicles.map(v => v.id))
  const counted = new Map<string, number>()
  for (const a of ((accounts as any[]) ?? [])) {
    counted.set(a.vehicle_id, (counted.get(a.vehicle_id) ?? 0) + 1)
  }

  return NextResponse.json(vehicles.map(v => ({
    ...v,
    accountCount: counted.get(v.id) ?? 0,
    // Seeded, not "complete": the seed is additive and a firm may have added accounts of its own,
    // so the question is whether a chart exists at all, not whether it matches ours exactly.
    chartSeeded: (counted.get(v.id) ?? 0) > 0,
    expectedAccounts: expected,
  })))
}

/**
 * POST — create a management company. { name }
 *
 * The general vehicle registry (/api/vehicles) can also create one, and does the same thing. This
 * exists because that route is gated on `accounting`: without it, someone granted only
 * `management_company` would open this section, be told there is no manco yet, and find that the
 * button to add one 403s. A route that can create exactly one kind of vehicle is a small price for
 * the section standing on its own grant.
 *
 * `kind` is not a parameter. This is the management-company section; anything else created here
 * would be a vehicle the section then refuses to show.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'A name is required' }, { status: 400 })

  const { data, error } = await admin
    .from('fund_vehicles' as any)
    .insert({ fund_id: gate.fundId, name, kind: MANCO_KIND, aliases: [], active: true })
    .select('id, name, kind, active')
    .single()
  if (error) {
    // unique (fund_id, name) — and the clash may be with a FUND of the same name, so the message
    // says "vehicle" rather than "management company".
    if ((error as any).code === '23505') {
      return NextResponse.json({ error: 'A vehicle with that name already exists' }, { status: 409 })
    }
    return dbError(error, 'manco-vehicles')
  }
  return NextResponse.json(data)
}
