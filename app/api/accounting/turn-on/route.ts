import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts). The middleware has already checked the grant.
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { DEFAULT_CHART, GP_ENTITY_CHART } from '@/lib/accounting/chart'
import { bootstrapOpeningBalances } from '@/lib/accounting/bootstrap'
import { positionDates } from '@/lib/accounting/lp-positions'
import { saveHistoryMode } from '@/lib/accounting/terms'

// POST — turn on fund accounting for a vehicle in ONE action. Seeds the chart (by kind), carries the
// latest pasted snapshot in as opening balances (cutover), and flips the producer to the ledger.
// No separate seed / choose-path / bootstrap / activate steps. Body: { group? }
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
  if (!vehicleId) return NextResponse.json({ error: `Unknown vehicle "${group}".` }, { status: 400 })

  // 1. Seed the chart by kind (associate → GP chart; else the standard fund chart). Additive.
  const { data: veh } = await admin.from('fund_vehicles' as any).select('kind').eq('fund_id', gate.fundId).eq('id', vehicleId).maybeSingle()
  const chart = (veh as any)?.kind === 'associate' ? GP_ENTITY_CHART : DEFAULT_CHART
  const { data: existing } = await admin
    .from('chart_of_accounts' as any)
    .select('code').eq('fund_id', gate.fundId).eq('vehicle_id', vehicleId)
  const have = new Set(((existing as any[]) ?? []).map(r => r.code as string))
  const missing = chart.filter(a => !have.has(a.code))
  let seeded = 0
  if (missing.length > 0) {
    const rows = missing.map(a => ({ fund_id: gate.fundId, portfolio_group: group, vehicle_id: vehicleId, code: a.code, name: a.name, type: a.type, subtype: a.subtype ?? null }))
    const { error } = await admin.from('chart_of_accounts' as any).insert(rows)
    if (error) return dbError(error, 'accounting-turn-on-seed')
    seeded = rows.length
  }

  // 2. Carry the latest pasted snapshot in as opening balances (cutover). No positions → nothing to
  //    carry, so the vehicle starts empty and builds from journal entries (full history from here).
  const dates = await positionDates(admin, gate.fundId, group)
  const cutover = dates.length > 0 ? dates[dates.length - 1] : null
  let booked = false
  let lpCount = 0
  if (cutover) {
    const r = await bootstrapOpeningBalances(admin, gate.fundId, group, user.id, cutover)
    // "No paid-in capital" is non-fatal — proceed with an empty opening and full-history mode.
    if (!('error' in r)) { booked = true; lpCount = r.lpCount }
  }
  const historyMode = booked ? 'cutover' : 'full_history'
  await saveHistoryMode(admin, gate.fundId, group, historyMode)

  // 3. Flip the producer to the ledger. The chart now exists, so capital won't read as zero.
  const { error: flipErr } = await admin
    .from('vehicle_accounting_settings' as any)
    .upsert(
      { fund_id: gate.fundId, vehicle_id: vehicleId, capital_source: 'ledger', updated_at: new Date().toISOString() },
      { onConflict: 'fund_id,vehicle_id' }
    )
  if (flipErr) return dbError(flipErr, 'accounting-turn-on-flip')

  return NextResponse.json({ ok: true, source: 'ledger', seeded, cutoverDate: booked ? cutover : null, lpCount, historyMode })
}
