import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { startQASession, getNextBatch, loadSessionState } from '@/lib/memo-agent/stages/qa'

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

  // Find the latest in-progress draft.
  const { data: draft } = await admin
    .from('diligence_memo_drafts')
    .select('id, ingestion_output, research_output')
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .eq('is_draft', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!draft) {
    return NextResponse.json({ error: 'Run Stage 1 ingest first.' }, { status: 409 })
  }
  if (!(draft as any).ingestion_output) {
    return NextResponse.json({ error: 'Run Stage 1 ingest first.' }, { status: 409 })
  }

  const draftId = (draft as any).id as string
  const sessionId = await startQASession({ admin, fundId, dealId: params.id, draftId, userId: user.id })

  let batch
  try {
    batch = await getNextBatch({ admin, fundId, dealId: params.id, draftId, sessionId })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Q&A failed' }, { status: 500 })
  }

  const state = await loadSessionState(admin, sessionId, fundId, draftId)
  return NextResponse.json({ session_id: sessionId, draft_id: draftId, ...batch, state })
}
