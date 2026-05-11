import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { enforceCapsForStage } from '@/lib/memo-agent/cost'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
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
    .select('id')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: draft } = await admin
    .from('diligence_memo_drafts')
    .select('id, ingestion_output')
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .eq('is_draft', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!draft || !(draft as any).ingestion_output) {
    return NextResponse.json({ error: 'Run Stage 1 ingest before drafting.' }, { status: 409 })
  }

  const { data: existing } = await admin
    .from('memo_agent_jobs')
    .select('id, kind, status')
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .in('status', ['pending', 'running'])
    .limit(1)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({
      error: `A ${(existing as any).kind} job is already ${(existing as any).status}.`,
      job_id: (existing as any).id,
    }, { status: 409 })
  }

  // Enforce caps for both draft and score (they run together).
  const enforcedDraft = await enforceCapsForStage({ admin, fundId, dealId: params.id, stage: 'draft' })
  if (!enforcedDraft.ok) {
    return NextResponse.json({ error: enforcedDraft.reason, estimate: enforcedDraft.estimate, caps: enforcedDraft.caps }, { status: 422 })
  }

  const { data: created, error } = await admin
    .from('memo_agent_jobs')
    .insert({
      fund_id: fundId,
      deal_id: params.id,
      draft_id: (draft as any).id,
      kind: 'draft',
      enqueued_by: user.id,
    } as any)
    .select('id, kind, status')
    .single()
  if (error || !created) return NextResponse.json({ error: error?.message ?? 'enqueue failed' }, { status: 500 })

  await admin
    .from('diligence_deals')
    .update({ current_memo_stage: 'draft' })
    .eq('id', params.id)
    .eq('fund_id', fundId)

  return NextResponse.json({
    job_id: (created as any).id,
    kind: 'draft',
    status: (created as any).status,
    estimate: enforcedDraft.estimate,
    caps: enforcedDraft.caps,
  })
}
