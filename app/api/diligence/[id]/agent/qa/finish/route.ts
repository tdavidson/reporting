import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { finishQA } from '@/lib/memo-agent/stages/qa'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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
  const fundId = (membership as any).fund_id as string

  const body = await req.json().catch(() => ({}))
  const sessionId = typeof body.session_id === 'string' ? body.session_id : ''
  const draftId = typeof body.draft_id === 'string' ? body.draft_id : ''
  if (!sessionId || !draftId) return NextResponse.json({ error: 'session_id and draft_id required' }, { status: 400 })

  try {
    const result = await finishQA({ admin, fundId, dealId: params.id, sessionId, draftId })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
