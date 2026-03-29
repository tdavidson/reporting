import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  const { data, error } = await admin
    .from('fund_group_config' as any)
    .select('*')
    .eq('fund_id', membership.fund_id) as { data: any[] | null; error: { message: string } | null }
  if (error) return dbError(error, 'fund-group-config')
  return NextResponse.json(data ?? [])
}

export async function PUT(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  const body = await req.json()
  const { portfolioGroup, cashOnHand, carryRate, gpCommitPct, vintage, managementFeeRate, performanceFeeRate, navMode, navOverride } = body
  if (!portfolioGroup) {
    return NextResponse.json({ error: 'portfolioGroup is required' }, { status: 400 })
  }
  const row: Record<string, any> = {
    fund_id: membership.fund_id,
    portfolio_group: portfolioGroup,
    updated_at: new Date().toISOString(),
  }
  if (cashOnHand !== undefined) {
    const v = parseFloat(cashOnHand ?? 0)
    row.cash_on_hand = isNaN(v) ? 0 : v
  }
  if (carryRate !== undefined) {
    const v = parseFloat(carryRate ?? 0.2)
    row.carry_rate = isNaN(v) ? 0.2 : v
  }
  if (gpCommitPct !== undefined) {
    const v = parseFloat(gpCommitPct ?? 0)
    row.gp_commit_pct = isNaN(v) ? 0 : v
  }
  if (vintage !== undefined) {
    row.vintage = vintage ? parseInt(vintage, 10) : null
  }
  if (managementFeeRate !== undefined) {
    const v = parseFloat(managementFeeRate ?? 0)
    row.management_fee_rate = isNaN(v) ? 0 : v
  }
  if (performanceFeeRate !== undefined) {
    const v = parseFloat(performanceFeeRate ?? 0)
    row.performance_fee_rate = isNaN(v) ? 0 : v
  }
  if (navMode !== undefined) {
    row.nav_mode = navMode === 'manual' ? 'manual' : 'metric'
  }
  if (navOverride !== undefined) {
    const v = parseFloat(navOverride ?? 0)
    row.nav_override = isNaN(v) ? null : v
  }
  const { data, error } = await admin
    .from('fund_group_config' as any)
    .upsert(row, { onConflict: 'fund_id,portfolio_group' })
    .select('*')
    .single() as { data: any; error: { message: string } | null }
  if (error) return dbError(error, 'fund-group-config-upsert')
  return NextResponse.json(data)
}
