import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbError } from '@/lib/api-error'

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  // Verify company belongs to this fund
  const { data: company } = await admin
    .from('companies')
    .select('id')
    .eq('id', params.id)
    .eq('fund_id', membership.fund_id)
    .maybeSingle()

  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '20', 10), 100)

  const { data: interactions, error } = await admin
    .from('interactions')
    .select('id, fund_id, company_id, email_id, user_id, tags, subject, summary, intro_contacts, body_preview, interaction_date, created_at')
    .eq('company_id', params.id)
    .eq('fund_id', membership.fund_id)
    .order('interaction_date', { ascending: false })
    .limit(limit)

  if (error) {
    return dbError(error, 'companies-id-interactions')
  }

  return NextResponse.json(interactions ?? [])
}
