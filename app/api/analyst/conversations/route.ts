import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

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
  if (!membership) return NextResponse.json({ error: 'No fund' }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId')
  const dealId = searchParams.get('dealId')
  const portfolio = searchParams.get('portfolio') === 'true'

  let query = admin
    .from('analyst_conversations')
    .select('id, title, company_id, deal_id, message_count, created_at, updated_at')
    .eq('fund_id', membership.fund_id)
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(20)

  if (dealId) {
    query = query.eq('deal_id', dealId)
  } else if (companyId) {
    query = query.eq('company_id', companyId).is('deal_id', null)
  } else if (portfolio) {
    query = query.is('company_id', null).is('deal_id', null)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ conversations: data })
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
  if (!membership) return NextResponse.json({ error: 'No fund' }, { status: 404 })

  let body: { companyId?: string }
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  // Verify company belongs to fund if provided
  if (body.companyId) {
    const { data: companyCheck } = await admin
      .from('companies')
      .select('fund_id')
      .eq('id', body.companyId)
      .maybeSingle()
    if (!companyCheck || companyCheck.fund_id !== membership.fund_id) {
      return NextResponse.json({ error: 'Invalid company' }, { status: 403 })
    }
  }

  const { data, error } = await admin
    .from('analyst_conversations')
    .insert({
      fund_id: membership.fund_id,
      user_id: user.id,
      company_id: body.companyId ?? null,
    })
    .select('id, title, company_id, message_count, created_at, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ conversation: data })
}
