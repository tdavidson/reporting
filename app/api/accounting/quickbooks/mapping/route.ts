import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts).
import { assertReadAccess, assertWriteAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'

// The saved QuickBooks → chart mapping for one vehicle.
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

  const { data } = await (admin as any).from('qb_account_mappings')
    .select('qb_account, account_code, excluded, note')
    .eq('fund_id', gate.fundId).eq('vehicle_id', vehicleId)
    .order('qb_account')
  return NextResponse.json({ mappings: data ?? [] })
}

// PUT — { group?, rows: [{ qbAccount, accountCode, excluded?, note? }] }
export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  if (!Array.isArray(body?.rows)) {
    return NextResponse.json({ error: 'rows[] is required' }, { status: 400 })
  }

  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? null)
  if (group instanceof NextResponse) return group
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)

  const rows = body.rows
    .filter((r: any) => typeof r?.qbAccount === 'string' && r.qbAccount.trim())
    .map((r: any) => ({
      fund_id: gate.fundId,
      vehicle_id: vehicleId,
      qb_account: r.qbAccount.trim(),
      account_code: r.accountCode ?? null,
      excluded: !!r.excluded,
      note: r.note ?? null,
      updated_at: new Date().toISOString(),
    }))

  if (rows.length === 0) return NextResponse.json({ saved: 0 })

  const { error } = await (admin as any).from('qb_account_mappings')
    .upsert(rows, { onConflict: 'fund_id,vehicle_id,qb_account' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ saved: rows.length })
}
