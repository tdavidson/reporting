import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const VALID_DEAL_STATUSES = ['active', 'passed', 'won', 'lost', 'on_hold'] as const
type DealStatus = typeof VALID_DEAL_STATUSES[number]

export async function GET(req: NextRequest) {
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

  const status = req.nextUrl.searchParams.get('status')
  const sector = req.nextUrl.searchParams.get('sector')
  const stage = req.nextUrl.searchParams.get('stage')
  const lead = req.nextUrl.searchParams.get('lead_partner')
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '200', 10), 500)

  let query = admin
    .from('diligence_deals')
    .select('id, fund_id, name, sector, stage_at_consideration, deal_status, current_memo_stage, lead_partner_id, promoted_company_id, created_at, updated_at')
    .eq('fund_id', (membership as any).fund_id)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (status) {
    const statuses = status.split(',').map(s => s.trim()).filter(s => VALID_DEAL_STATUSES.includes(s as DealStatus))
    if (statuses.length) query = query.in('deal_status', statuses)
  }
  if (sector) query = query.eq('sector', sector)
  if (stage) query = query.eq('stage_at_consideration', stage)
  if (lead) query = query.eq('lead_partner_id', lead)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
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

  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const insert: Record<string, unknown> = {
    fund_id: (membership as any).fund_id,
    name,
    created_by: user.id,
  }
  if (typeof body.sector === 'string' && body.sector.trim()) insert.sector = body.sector.trim()
  if (typeof body.stage_at_consideration === 'string' && body.stage_at_consideration.trim()) {
    insert.stage_at_consideration = body.stage_at_consideration.trim()
  }
  if (typeof body.lead_partner_id === 'string' && body.lead_partner_id) {
    insert.lead_partner_id = body.lead_partner_id
  }

  const { data, error } = await admin
    .from('diligence_deals')
    .insert(insert as any)
    .select('id, name, sector, stage_at_consideration, deal_status, current_memo_stage, lead_partner_id, created_at, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
