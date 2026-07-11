import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { kickWorker } from '@/lib/memo-agent/kick'

/**
 * Enqueue a manual checklist-assessment job. The auto-trigger from
 * ingest_synthesis handles the common case; this endpoint exists so the
 * partner can re-run after editing the checklist or after a fresh data-room
 * upload without re-running ingest.
 */
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

  const { count: checklistCount } = await (admin as any)
    .from('diligence_checklist_items')
    .select('id', { count: 'exact', head: true })
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .eq('kind', 'item')
  if (!checklistCount || checklistCount === 0) {
    return NextResponse.json({ error: 'No checklist items to assess. Apply a fund default or paste a checklist first.' }, { status: 400 })
  }

  const { data: created, error } = await admin
    .from('memo_agent_jobs')
    .insert({
      fund_id: fundId,
      deal_id: params.id,
      kind: 'checklist_assessment',
      payload: {},
      enqueued_by: user.id,
    } as any)
    .select('id, status, enqueued_at')
    .single()

  if (error || !created) return NextResponse.json({ error: error?.message ?? 'enqueue failed' }, { status: 500 })
  await kickWorker() // start the worker now instead of waiting for the cron

  return NextResponse.json({
    job_id: (created as any).id,
    kind: 'checklist_assessment',
    status: (created as any).status,
  })
}
