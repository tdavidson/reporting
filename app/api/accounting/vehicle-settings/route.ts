import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts). The middleware has already checked the grant.
import { assertWriteAccess, assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { dbError } from '@/lib/api-error'

// Per-vehicle operational settings that aren't part of the books.
//
// Today: wire instructions for capital-call notices. Kept on the VEHICLE rather than on each
// call — an SPV's bank details are a standing fact, and re-typing them into every call is how
// one notice goes out with a stale account number.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)

  const { data } = await admin
    .from('vehicle_accounting_settings' as any)
    .select('wire_instructions')
    .eq('fund_id', gate.fundId).eq('vehicle_id', vehicleId)
    .maybeSingle()
  return NextResponse.json({ wireInstructions: (data as any)?.wire_instructions ?? '' })
}

// PATCH — { wireInstructions }
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)
  if (!vehicleId) return NextResponse.json({ error: `Unknown vehicle "${group}".` }, { status: 400 })

  if (typeof body?.wireInstructions !== 'string') {
    return NextResponse.json({ error: 'wireInstructions (string) is required' }, { status: 400 })
  }

  // Upsert: a vehicle that has never had accounting settings has no row yet.
  const { error } = await admin
    .from('vehicle_accounting_settings' as any)
    .upsert(
      { fund_id: gate.fundId, vehicle_id: vehicleId, wire_instructions: body.wireInstructions.trim() || null, updated_at: new Date().toISOString() },
      { onConflict: 'fund_id,vehicle_id' }
    )
  if (error) return dbError(error, 'accounting-vehicle-settings')
  return NextResponse.json({ ok: true })
}
