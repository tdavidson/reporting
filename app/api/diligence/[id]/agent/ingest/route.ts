import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { enforceCapsForStage } from '@/lib/memo-agent/cost'

/**
 * Enqueue an ingest job. The cron worker picks it up within ~1 minute.
 * Returns the job_id immediately so the UI can poll for status.
 */
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

  // Verify deal.
  const { data: deal } = await admin
    .from('diligence_deals')
    .select('id')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Reject if there's already a pending or running job for this deal.
  const { data: existing } = await admin
    .from('memo_agent_jobs')
    .select('id, status, kind')
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

  const body = await req.json().catch(() => ({}))
  const documentIds = Array.isArray(body.document_ids)
    ? body.document_ids.filter((x: unknown): x is string => typeof x === 'string')
    : undefined

  // Cost cap enforcement.
  const enforced = await enforceCapsForStage({ admin, fundId, dealId: params.id, stage: 'ingest' })
  if (!enforced.ok) {
    return NextResponse.json({ error: enforced.reason, estimate: enforced.estimate, caps: enforced.caps }, { status: 422 })
  }

  const { data: created, error } = await admin
    .from('memo_agent_jobs')
    .insert({
      fund_id: fundId,
      deal_id: params.id,
      kind: 'ingest',
      payload: documentIds && documentIds.length > 0 ? { document_ids: documentIds } : {},
      enqueued_by: user.id,
    } as any)
    .select('id, kind, status, enqueued_at')
    .single()

  if (error || !created) return NextResponse.json({ error: error?.message ?? 'enqueue failed' }, { status: 500 })

  // Bump deal's current_memo_stage to 'ingest' so the UI shows progress.
  await admin
    .from('diligence_deals')
    .update({ current_memo_stage: 'ingest' })
    .eq('id', params.id)
    .eq('fund_id', fundId)

  return NextResponse.json({
    job_id: (created as any).id,
    kind: 'ingest',
    status: (created as any).status,
    estimate: enforced.estimate,
    caps: enforced.caps,
  })
}
