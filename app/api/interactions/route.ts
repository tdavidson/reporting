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

  const tag = req.nextUrl.searchParams.get('tag')
  const companyId = req.nextUrl.searchParams.get('company_id')
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '50', 10), 200)

  let query = admin
    .from('interactions')
    .select('id, fund_id, company_id, email_id, user_id, tags, subject, summary, intro_contacts, body_preview, interaction_date, created_at')
    .eq('fund_id', membership.fund_id)
    .order('interaction_date', { ascending: false })
    .limit(limit)

  if (tag) {
    query = query.contains('tags', [tag])
  }
  if (companyId) {
    query = query.eq('company_id', companyId)
  }

  const { data: interactions, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Batch-load company names
  const companyIds = Array.from(new Set((interactions ?? []).map(i => (i as any).company_id).filter(Boolean))) as string[]
  const companyNameMap: Record<string, string> = {}
  if (companyIds.length > 0) {
    const { data: companies } = await admin
      .from('companies')
      .select('id, name')
      .in('id', companyIds) as { data: { id: string; name: string }[] | null }
    for (const c of companies ?? []) {
      companyNameMap[c.id] = c.name
    }
  }

  const result = (interactions ?? []).map((i: any) => ({
    ...i,
    company_name: i.company_id ? companyNameMap[i.company_id] ?? null : null,
  }))

  return NextResponse.json(result)
}
