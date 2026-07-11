import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { kickWorker } from '@/lib/memo-agent/kick'

/**
 * Enqueue a transcription job for a single call recording. Standalone —
 * transcription produces a transcript document but does not auto-run memo
 * ingest; the partner Processes the transcript separately when ready.
 *
 * Body: { document_id: string } — must be a `call_recording` document.
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

  const body = await req.json().catch(() => ({}))
  const documentId = typeof body.document_id === 'string' ? body.document_id : null
  if (!documentId) return NextResponse.json({ error: 'document_id required' }, { status: 400 })

  // Verify the document belongs to this deal/fund and is a recording.
  const { data: doc } = await admin
    .from('diligence_documents')
    .select('id, detected_type')
    .eq('id', documentId)
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  if ((doc as any).detected_type !== 'call_recording') {
    return NextResponse.json({ error: 'Only call recordings can be transcribed.' }, { status: 422 })
  }

  // One active job per deal — the worker claims one at a time.
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

  const { data: created, error } = await admin
    .from('memo_agent_jobs')
    .insert({
      fund_id: fundId,
      deal_id: params.id,
      kind: 'transcribe',
      payload: { document_id: documentId },
      enqueued_by: user.id,
    } as any)
    .select('id, kind, status')
    .single()
  if (error || !created) {
    return NextResponse.json({ error: error?.message ?? 'enqueue failed' }, { status: 500 })
  }
  await kickWorker() // start the worker now instead of waiting for the cron

  return NextResponse.json({
    job_id: (created as any).id,
    kind: 'transcribe',
    status: (created as any).status,
  })
}
