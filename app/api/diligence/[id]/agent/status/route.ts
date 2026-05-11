import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Polled by the deal detail UI while a memo-agent job is in flight.
 * Returns the most recent job for the deal plus a snapshot of which
 * stages have output on the latest draft.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
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

  const { data: deal } = await admin
    .from('diligence_deals')
    .select('id, current_memo_stage')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [{ data: latestJob }, { data: latestDraft }] = await Promise.all([
    admin
      .from('memo_agent_jobs')
      .select('id, kind, status, progress_message, error, attempts, enqueued_at, started_at, finished_at, result')
      .eq('deal_id', params.id)
      .eq('fund_id', fundId)
      .order('enqueued_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('diligence_memo_drafts')
      .select('id, draft_version, ingestion_output, research_output, qa_answers, memo_draft_output, is_draft, created_at, finalized_at')
      .eq('deal_id', params.id)
      .eq('fund_id', fundId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  return NextResponse.json({
    deal: { id: (deal as any).id, current_memo_stage: (deal as any).current_memo_stage },
    latest_job: latestJob ?? null,
    latest_draft: latestDraft ? {
      id: (latestDraft as any).id,
      draft_version: (latestDraft as any).draft_version,
      is_draft: (latestDraft as any).is_draft,
      created_at: (latestDraft as any).created_at,
      finalized_at: (latestDraft as any).finalized_at,
      has_ingestion: !!(latestDraft as any).ingestion_output,
      has_research: !!(latestDraft as any).research_output,
      has_qa: !!(latestDraft as any).qa_answers,
      has_memo_draft: !!(latestDraft as any).memo_draft_output,
    } : null,
  })
}
