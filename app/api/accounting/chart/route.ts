import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts). The middleware has already checked the caller's
// grant for this route + method; these resolve identity and keep the demo out of writes.
import { assertWriteAccess, assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { dbError } from '@/lib/api-error'
import { DEFAULT_CHART, GP_ENTITY_CHART } from '@/lib/accounting/chart'

// GET — list the vehicle's chart of accounts.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)

  const { data, error } = await admin
    .from('chart_of_accounts' as any)
    .select('*')
    .eq('fund_id', gate.fundId)
    .eq('vehicle_id', vehicleId)
    .order('code', { ascending: true })
  if (error) return dbError(error, 'accounting-chart')
  return NextResponse.json(data ?? [])
}

// POST — seed the default chart for the vehicle (no-op if any account exists).
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
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)

  // GP / associate entities keep their own books (Investment in Fund, members'
  // capital, carry) — seed the GP chart for them; every other vehicle gets the
  // standard fund chart.
  const { data: veh } = await admin.from('fund_vehicles' as any).select('kind').eq('fund_id', gate.fundId).eq('id', vehicleId).maybeSingle()
  const chart = (veh as any)?.kind === 'associate' ? GP_ENTITY_CHART : DEFAULT_CHART

  // Additive/idempotent: seed the full chart on first run, and on later runs
  // backfill any accounts the vehicle is missing (e.g. a newly-added standard
  // account). Never touches existing rows or custom accounts.
  const { data: existing } = await admin
    .from('chart_of_accounts' as any)
    .select('code')
    .eq('fund_id', gate.fundId)
    .eq('vehicle_id', vehicleId)
  const have = new Set(((existing as any[]) ?? []).map(r => r.code as string))
  const missing = chart.filter(a => !have.has(a.code))
  if (missing.length === 0) return NextResponse.json({ seeded: 0, message: 'Chart already up to date' })

  const rows = missing.map(a => ({ fund_id: gate.fundId, portfolio_group: group, vehicle_id: vehicleId, code: a.code, name: a.name, type: a.type, subtype: a.subtype ?? null }))
  const { data, error } = await admin.from('chart_of_accounts' as any).insert(rows).select('*')
  if (error) return dbError(error, 'accounting-chart-seed')
  return NextResponse.json({ seeded: (data as any[])?.length ?? 0, accounts: data ?? [] })
}
