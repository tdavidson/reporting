import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseCallbackPayload } from '@/lib/transcription/deepgram'
import { logAIUsage } from '@/lib/ai/usage'
import { uploadTranscriptToDrive } from '@/lib/memo-agent/render/gdoc'
import { parseDriveFolderUrl } from '@/lib/google/drive'
import { dbError } from '@/lib/api-error'
import { hashCallbackToken } from '@/lib/transcription/callback-token'

/**
 * Deepgram callback endpoint. Receives the transcript for a prerecorded
 * audio submission and:
 *   1. Looks up the memo_agent_jobs row by external_job_id (Deepgram's
 *      request_id) or by the tag we attached at submit time.
 *   2. Writes the formatted transcript text into the diligence-documents
 *      bucket and creates a new diligence_documents row of type
 *      call_transcript (parse_status 'pending'), linked back to the
 *      recording via source_document_id.
 *   3. Bulk-inserts per-utterance turns into diligence_call_transcripts.
 *   4. Marks the transcribe job success. The transcript is left as a
 *      pending document — transcription is decoupled from memo ingest, so
 *      a partner explicitly Processes the transcript when they want it in
 *      the draft.
 *
 * AUTH (SEC-010). Deepgram does not sign prerecorded callbacks, so the URL is the only channel we
 * have to authenticate with. It used to carry one shared secret for every job, which meant two
 * things: the secret was copied into every proxy access log and tracing span that records a path,
 * and whoever read it there could write transcript content to ANY job whose id they could guess.
 *
 * Now the path carries a token minted for THIS job (lib/transcription/callback-token.ts). The token
 * is the job lookup — not a gate in front of a lookup by a guessable tag — so it authenticates and
 * addresses in one step, and it is cleared once the callback is processed. A leaked URL is worth
 * one already-finished job.
 *
 * The shared secret is gone. It survived one deployment as a fallback so that transcriptions
 * submitted by the previous release still landed, and was removed immediately afterwards —
 * TRANSCRIPTION_WEBHOOK_SECRET is no longer read anywhere and can be deleted from the environment.
 */
const JOB_COLUMNS = 'id, fund_id, deal_id, payload, status'

interface CallbackJob {
  id: string
  fund_id: string
  deal_id: string
  payload: Record<string, unknown>
  status: string
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const parsed = parseCallbackPayload(body)
  const admin = createAdminClient()

  // The token IS the lookup. Presenting it proves the caller was told about this specific job,
  // which is what the shared secret could never establish.
  const { data: byToken } = await admin
    .from('memo_agent_jobs')
    .select(JOB_COLUMNS)
    .eq('callback_token_hash', hashCallbackToken(params.token))
    .maybeSingle()

  // One 401 for a wrong token, an unknown job, and a spent token alike, so none of the three can be
  // told apart from outside. Deliberately not a 400 about a missing tag: answering the payload
  // before the credential told an unauthenticated caller which half they had wrong.
  const job = (byToken as unknown as CallbackJob | null) ?? null
  if (!job) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    return dbError(upErr, 'transcription-webhook')
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
      // Pending, not parsed — transcription is decoupled from ingest. The
      // transcript shows in the data room with a Process action the partner
      // can run when they want it folded into the memo.
      parse_status: 'pending',
      source_document_id: documentId,
    } as any)
    .select('id')
    .single()
  if (insertErr || !insertedDoc) {
    await admin.storage.from('diligence-documents').remove([storagePath]).catch(() => {})
    await markFailed(admin, job.id, `transcript row insert failed: ${insertErr?.message ?? 'unknown'}`)
    return dbError(insertErr ?? { message: 'insert failed' }, 'transcription-webhook')
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

  // Mirror the transcript into the deal's Google Drive data-room folder so it
  // lives alongside the recordings, not only in the database. Best-effort —
  // the transcript is already saved in Supabase; a Drive failure must not
  // fail the webhook.
  try {
    const { data: deal } = await admin
      .from('diligence_deals')
      .select('drive_folder_url')
      .eq('id', job.deal_id)
      .eq('fund_id', job.fund_id)
      .maybeSingle()
    const folderUrl = (deal as { drive_folder_url: string | null } | null)?.drive_folder_url ?? null
    const driveFolderId = folderUrl ? parseDriveFolderUrl(folderUrl) : null
    if (driveFolderId) {
      const drive = await uploadTranscriptToDrive({
        admin,
        fundId: job.fund_id,
        filename: transcriptName,
        text: parsed.full_text,
        folderId: driveFolderId,
      })
      if (drive.webViewLink) {
        await admin
          .from('diligence_documents')
          .update({ drive_source_url: drive.webViewLink } as any)
          .eq('id', transcriptDocId)
      }
    }
  } catch (err) {
    console.warn(`[transcription-webhook] Drive mirror failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Transcription is decoupled from memo ingest — the transcript document is
  // left pending for the partner to Process explicitly. No ingest job is
  // enqueued here.

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
      // Single use: the callback has landed, so the token in that URL is spent. Whatever logs
      // recorded the path now hold a credential that opens nothing.
      callback_token_hash: null,
    })
    .eq('id', job.id)

  // Record transcription in AI usage (per-minute billed, not token-based) so it
  // shows up in the per-deal and fund-wide usage reports.
  await logAIUsage(admin, {
    fundId: job.fund_id,
    dealId: job.deal_id,
    provider: 'deepgram',
    model: `deepgram/${process.env.DEEPGRAM_MODEL ?? 'nova-3'}`,
    feature: 'transcription',
    audioSeconds: Math.round(parsed.duration_seconds ?? 0),
  })

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
      // Spent either way — a failed callback is still a delivered one, and the job is terminal.
      callback_token_hash: null,
    })
    .eq('id', jobId)
}

// Storage keys must be ASCII-safe — Supabase rejects spaces, brackets, and
// other characters common in recording filenames (e.g. "Call [PHI redacted]").
// Used only for the object key; the human-readable file_name keeps the original.
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200)
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}
