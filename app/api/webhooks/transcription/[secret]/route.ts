import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseCallbackPayload } from '@/lib/transcription/deepgram'

/**
 * Deepgram callback endpoint. Receives the transcript for a prerecorded
 * audio submission and:
 *   1. Looks up the memo_agent_jobs row by external_job_id (Deepgram's
 *      request_id) or by the tag we attached at submit time.
 *   2. Writes the formatted transcript text into the diligence-documents
 *      bucket and creates a new diligence_documents row of type
 *      call_transcript, linked back to the recording via source_document_id.
 *   3. Bulk-inserts per-utterance turns into diligence_call_transcripts.
 *   4. Marks the transcribe job success and enqueues an ingest job so the
 *      transcript flows into the memo draft.
 *
 * Auth is a shared secret carried in the path; Deepgram's prerecorded
 * callbacks aren't signed, so this is the simplest defensible scheme. Don't
 * leak the URL — anyone with the secret can write transcript content to any
 * job referenced by a tag they can guess.
 */
export async function POST(req: NextRequest, { params }: { params: { secret: string } }) {
  const expected = process.env.TRANSCRIPTION_WEBHOOK_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'TRANSCRIPTION_WEBHOOK_SECRET not configured' }, { status: 500 })
  }
  if (!timingSafeEqual(params.secret, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const parsed = parseCallbackPayload(body)
  if (!parsed.request_id && !parsed.external_ref) {
    return NextResponse.json({ error: 'Callback missing request_id and tag' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Prefer the tag (our job id) — it's what we set; the Deepgram request_id
  // is the secondary lookup if the tag was lost in transit.
  let job: {
    id: string
    fund_id: string
    deal_id: string
    payload: Record<string, unknown>
    status: string
  } | null = null

  if (parsed.external_ref) {
    const { data } = await admin
      .from('memo_agent_jobs')
      .select('id, fund_id, deal_id, payload, status')
      .eq('id', parsed.external_ref)
      .maybeSingle()
    job = (data as any) ?? null
  }
  if (!job && parsed.request_id) {
    const { data } = await admin
      .from('memo_agent_jobs')
      .select('id, fund_id, deal_id, payload, status')
      .eq('external_job_id', parsed.request_id)
      .maybeSingle()
    job = (data as any) ?? null
  }
  if (!job) return NextResponse.json({ error: 'No matching job' }, { status: 404 })

  if (job.status === 'success') {
    // Idempotency: if Deepgram retries, don't double-write.
    return NextResponse.json({ ok: true, deduped: true })
  }

  const documentId = typeof job.payload?.document_id === 'string'
    ? job.payload.document_id as string
    : null
  if (!documentId) {
    await markFailed(admin, job.id, 'job payload missing document_id')
    return NextResponse.json({ error: 'job payload missing document_id' }, { status: 400 })
  }

  const { data: recording } = await admin
    .from('diligence_documents')
    .select('id, file_name')
    .eq('id', documentId)
    .eq('fund_id', job.fund_id)
    .maybeSingle()
  if (!recording) {
    await markFailed(admin, job.id, `recording document ${documentId} not found`)
    return NextResponse.json({ error: 'recording not found' }, { status: 404 })
  }

  // Write the formatted transcript text into the diligence-documents bucket
  // so existing readers (ingest pipeline, document download) can pick it up
  // without special-casing.
  const baseName = (recording as any).file_name as string
  const transcriptName = `${stripExtension(baseName)}.transcript.txt`
  const storagePath = `${job.deal_id}/transcripts/${Date.now()}_${sanitize(transcriptName)}`
  const buffer = Buffer.from(parsed.full_text, 'utf8')

  const { error: upErr } = await admin.storage
    .from('diligence-documents')
    .upload(storagePath, buffer, { contentType: 'text/plain; charset=utf-8', upsert: false })
  if (upErr) {
    await markFailed(admin, job.id, `transcript upload failed: ${upErr.message}`)
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  const { data: insertedDoc, error: insertErr } = await admin
    .from('diligence_documents')
    .insert({
      deal_id: job.deal_id,
      fund_id: job.fund_id,
      storage_path: storagePath,
      file_name: transcriptName,
      file_format: 'txt',
      file_size_bytes: buffer.length,
      detected_type: 'call_transcript',
      type_confidence: 'high',
      parse_status: 'parsed',
      source_document_id: documentId,
    } as any)
    .select('id')
    .single()
  if (insertErr || !insertedDoc) {
    await admin.storage.from('diligence-documents').remove([storagePath]).catch(() => {})
    await markFailed(admin, job.id, `transcript row insert failed: ${insertErr?.message ?? 'unknown'}`)
    return NextResponse.json({ error: insertErr?.message ?? 'insert failed' }, { status: 500 })
  }
  const transcriptDocId = (insertedDoc as any).id as string

  if (parsed.utterances.length > 0) {
    const turnRows = parsed.utterances.map(u => ({
      document_id: transcriptDocId,
      deal_id: job!.deal_id,
      fund_id: job!.fund_id,
      speaker: u.speaker,
      start_ms: u.start_ms,
      end_ms: u.end_ms,
      text: u.text,
    }))
    const { error: turnErr } = await (admin as any)
      .from('diligence_call_transcripts')
      .insert(turnRows)
    if (turnErr) {
      // Don't fail the whole webhook on turn-insert failure — the plain-text
      // transcript is already saved and is what the ingest stage reads.
      console.warn(`[transcription-webhook] turn insert failed: ${turnErr.message}`)
    }
  }

  // Mark recording as transcribed so the data-room UI can show that state.
  await admin
    .from('diligence_documents')
    .update({ parse_status: 'transcribed' } as any)
    .eq('id', documentId)

  // Auto-enqueue an ingest job for the new transcript so it flows into the
  // memo draft without a second user action. Only if no other job is active.
  const { data: activeJob } = await admin
    .from('memo_agent_jobs')
    .select('id')
    .eq('deal_id', job.deal_id)
    .eq('fund_id', job.fund_id)
    .in('status', ['pending', 'running'])
    .neq('id', job.id)
    .limit(1)
    .maybeSingle()
  if (!activeJob) {
    await admin
      .from('memo_agent_jobs')
      .insert({
        fund_id: job.fund_id,
        deal_id: job.deal_id,
        kind: 'ingest',
        payload: { document_ids: [transcriptDocId] },
      } as any)
  }

  await admin
    .from('memo_agent_jobs')
    .update({
      status: 'success',
      finished_at: new Date().toISOString(),
      progress_message: 'completed',
      result: {
        transcript_document_id: transcriptDocId,
        utterances: parsed.utterances.length,
        duration_seconds: parsed.duration_seconds,
      } as any,
    })
    .eq('id', job.id)

  return NextResponse.json({ ok: true, transcript_document_id: transcriptDocId })
}

async function markFailed(admin: ReturnType<typeof createAdminClient>, jobId: string, error: string) {
  await admin
    .from('memo_agent_jobs')
    .update({
      status: 'failed',
      error,
      finished_at: new Date().toISOString(),
      progress_message: 'failed',
    })
    .eq('id', jobId)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

function sanitize(name: string): string {
  return name.replace(/[\/\\:*?"<>|\x00-\x1f\x7f]/g, '_').replace(/\.\./g, '_').slice(0, 200)
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}
