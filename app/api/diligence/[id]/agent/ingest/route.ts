import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { kickWorker } from '@/lib/memo-agent/kick'
import { enforceCapsForStage } from '@/lib/memo-agent/cost'
import { AUDIO_VIDEO_FORMATS } from '@/lib/memo-agent/ingestion/sources'

// Checklist statuses that still warrant (re)assessment — mirrors the stage's
// default scope. 'found' and 'not_applicable' are settled and skipped.
const ASSESSABLE_STATUSES = new Set(['unknown', 'partial', 'missing'])

/**
 * Enqueue a data-room analysis. Re-analyze is incremental: it only ingests
 * documents that haven't been parsed yet (new + previously-failed) and, when
 * there's nothing new to ingest, runs just the checklist checks against the
 * existing ingest output. The cron worker picks the job up within ~1 minute.
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
  const explicitIds: string[] | undefined = Array.isArray(body.document_ids)
    ? body.document_ids.filter((x: unknown): x is string => typeof x === 'string')
    : undefined
  const full = body.full === true

  // "Re-analyze everything": re-ingest the whole data room (replacing stale
  // results) and re-assess every checklist item. The ingest job resolves the
  // full document set itself when no document_ids are passed.
  if (full && (!explicitIds || explicitIds.length === 0)) {
    const { data: docRows } = await admin
      .from('diligence_documents')
      .select('id, file_format, detected_type')
      .eq('deal_id', params.id)
      .eq('fund_id', fundId)
      .neq('parse_status', 'skipped')
      .neq('detected_type', 'call_recording')
    const hasDocs = ((docRows ?? []) as Array<{ id: string; file_format: string | null }>)
      .some(r => !AUDIO_VIDEO_FORMATS.has((r.file_format ?? '').toLowerCase()))

    if (hasDocs) {
      const enforced = await enforceCapsForStage({ admin, fundId, dealId: params.id, stage: 'ingest' })
      if (!enforced.ok) {
        return NextResponse.json({ error: enforced.reason, estimate: enforced.estimate, caps: enforced.caps }, { status: 422 })
      }
      const { data: created, error } = await admin
        .from('memo_agent_jobs')
        .insert({ fund_id: fundId, deal_id: params.id, kind: 'ingest', payload: { full: true }, enqueued_by: user.id } as any)
        .select('id, kind, status')
        .single()
      if (error || !created) return NextResponse.json({ error: error?.message ?? 'enqueue failed' }, { status: 500 })
      await kickWorker()
      await admin.from('diligence_deals').update({ current_memo_stage: 'ingest' }).eq('id', params.id).eq('fund_id', fundId)
      return NextResponse.json({
        job_id: (created as any).id,
        kind: 'ingest',
        status: (created as any).status,
        full: true,
        estimate: enforced.estimate,
        caps: enforced.caps,
        message: 'Re-analyzing everything, re-ingesting all files and re-checking every checklist item.',
      })
    }

    // No documents to ingest — re-assess the full checklist if there is one.
    const { count: itemCount } = await (admin as any)
      .from('diligence_checklist_items')
      .select('id', { count: 'exact', head: true })
      .eq('deal_id', params.id)
      .eq('fund_id', fundId)
      .eq('kind', 'item')
    if (itemCount && itemCount > 0) {
      const { data: clJob, error: clErr } = await admin
        .from('memo_agent_jobs')
        .insert({ fund_id: fundId, deal_id: params.id, kind: 'checklist_assessment', payload: { all: true }, enqueued_by: user.id } as any)
        .select('id, kind, status')
        .single()
      if (clErr || !clJob) return NextResponse.json({ error: clErr?.message ?? 'enqueue failed' }, { status: 500 })
      await kickWorker()
      return NextResponse.json({ job_id: (clJob as any).id, kind: 'checklist_assessment', status: (clJob as any).status, full: true })
    }
    return NextResponse.json({ skipped: true, message: 'No documents or checklist to analyze.' })
  }

  // Determine what actually needs work. An explicit document_ids list (e.g. the
  // "Reprocess failed" button) is honored as-is. Otherwise compute the delta:
  // documents not yet parsed need ingestion; if none do, fall back to running
  // just the checklist checks for items that aren't already settled.
  let docsToIngest: string[] | undefined = explicitIds
  if (!explicitIds || explicitIds.length === 0) {
    const { data: docRows } = await admin
      .from('diligence_documents')
      .select('id, parse_status, file_format, detected_type')
      .eq('deal_id', params.id)
      .eq('fund_id', fundId)
      .neq('parse_status', 'skipped')
      .neq('detected_type', 'call_recording')
    docsToIngest = ((docRows ?? []) as Array<{ id: string; parse_status: string; file_format: string | null }>)
      .filter(r => !AUDIO_VIDEO_FORMATS.has((r.file_format ?? '').toLowerCase()))
      .filter(r => r.parse_status !== 'parsed')
      .map(r => r.id)
  }

  // Nothing new to ingest — run just the checklist assessment (covers newly
  // added checklist items + still-open ones), or no-op if it's all settled.
  if (docsToIngest && docsToIngest.length === 0) {
    const { count: pendingItems } = await (admin as any)
      .from('diligence_checklist_items')
      .select('id', { count: 'exact', head: true })
      .eq('deal_id', params.id)
      .eq('fund_id', fundId)
      .eq('kind', 'item')
      .in('status', Array.from(ASSESSABLE_STATUSES))

    if (!pendingItems || pendingItems === 0) {
      return NextResponse.json({
        skipped: true,
        up_to_date: true,
        message: 'Data room and checklist are already up to date, nothing new to analyze.',
      })
    }

    const { data: clJob, error: clErr } = await admin
      .from('memo_agent_jobs')
      .insert({
        fund_id: fundId,
        deal_id: params.id,
        kind: 'checklist_assessment',
        payload: {},
        enqueued_by: user.id,
      } as any)
      .select('id, kind, status')
      .single()
    if (clErr || !clJob) return NextResponse.json({ error: clErr?.message ?? 'enqueue failed' }, { status: 500 })
    await kickWorker()
    return NextResponse.json({
      job_id: (clJob as any).id,
      kind: 'checklist_assessment',
      status: (clJob as any).status,
      skipped_ingestion: true,
      message: 'Data room unchanged, re-checking the checklist against the existing analysis.',
    })
  }

  // Cost cap enforcement (ingest path only).
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
      payload: docsToIngest && docsToIngest.length > 0 ? { document_ids: docsToIngest } : {},
      enqueued_by: user.id,
    } as any)
    .select('id, kind, status, enqueued_at')
    .single()

  if (error || !created) return NextResponse.json({ error: error?.message ?? 'enqueue failed' }, { status: 500 })
  await kickWorker()

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
    analyzing_documents: docsToIngest?.length ?? null,
    estimate: enforced.estimate,
    caps: enforced.caps,
  })
}
