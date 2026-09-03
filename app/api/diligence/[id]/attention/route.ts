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
  const fundId = (membership as any).fund_id as string

  const status = req.nextUrl.searchParams.get('status') ?? 'open'

  let query = admin
    .from('diligence_attention_items')
    .select('id, deal_id, draft_id, kind, urgency, body, links, status, resolution_note, resolved_by, resolved_at, created_at')
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .order('created_at', { ascending: false })

  if (status !== 'all') query = query.eq('status', status)

  const { data, error } = await query
  if (error) return dbError(error, 'diligence-attention-list')
  return NextResponse.json(data ?? [])
}
