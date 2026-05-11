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

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const status = req.nextUrl.searchParams.get('status')          // comma-separated, e.g. "new,reviewing"
  const fitScore = req.nextUrl.searchParams.get('fit_score')      // strong | moderate | weak | out_of_thesis
  const introSource = req.nextUrl.searchParams.get('intro_source')
  const search = req.nextUrl.searchParams.get('q')                // company or founder name
  const includeArchived = req.nextUrl.searchParams.get('archived') === 'true'
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '100', 10), 500)

  let query = admin
    .from('inbound_deals')
    .select('id, fund_id, email_id, company_name, company_url, company_domain, founder_name, founder_email, intro_source, referrer_name, thesis_fit_score, stage, industry, raise_amount, status, prior_deal_id, created_at')
    .eq('fund_id', membership.fund_id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status) {
    const statuses = status.split(',').map(s => s.trim()).filter(Boolean)
    if (statuses.length) query = query.in('status', statuses)
  } else if (!includeArchived) {
    query = query.neq('status', 'archived')
  }

  if (fitScore) query = query.eq('thesis_fit_score', fitScore)
  if (introSource) query = query.eq('intro_source', introSource)
  if (search) {
    const escaped = search.replace(/[%_]/g, '\\$&')
    query = query.or(`company_name.ilike.%${escaped}%,founder_name.ilike.%${escaped}%,founder_email.ilike.%${escaped}%`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data ?? [])
}
