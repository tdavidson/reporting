import { createAdminClient } from '@/lib/supabase/admin'
import { submitForTranscription } from '@/lib/transcription/deepgram'

type Admin = ReturnType<typeof createAdminClient>

interface TranscribeJob {
  id: string
  fund_id: string
  deal_id: string
  draft_id: string | null
  payload: Record<string, unknown>
}

/**
 * Sentinel return value from runTranscribeJob. The worker checks for this
 * and leaves the job row in `running` status — only the Deepgram webhook
 * (app/api/webhooks/transcription) marks it `success` once the transcript
 * has actually arrived.
 */
export interface AwaitingCallback {
  awaiting_callback: true
  external_job_id: string
  document_id: string
}

const SIGNED_URL_TTL_SECONDS = 60 * 60  // 1 hour — long enough for any prerecorded job.
const RECORDINGS_BUCKET = 'diligence-recordings'
const DOCUMENTS_BUCKET = 'diligence-documents'

export async function runTranscribeJob(admin: Admin, job: TranscribeJob): Promise<AwaitingCallback> {
  const documentId = typeof job.payload?.document_id === 'string'
    ? job.payload.document_id as string
    : null
  if (!documentId) throw new Error('transcribe job payload missing document_id')

  await admin
    .from('memo_agent_jobs')
    .update({ progress_message: 'Locating recording' })
    .eq('id', job.id)

  const { data: doc, error: docErr } = await (admin as any)
    .from('diligence_documents')
    .select('id, deal_id, fund_id, storage_path, file_name, file_format, external_source')
    .eq('id', documentId)
    .eq('fund_id', job.fund_id)
    .maybeSingle()
  if (docErr) throw new Error(`Failed to load document: ${docErr.message}`)
  if (!doc) throw new Error(`Recording document ${documentId} not found in fund`)

  const row = doc as {
    id: string
    deal_id: string
    fund_id: string
    storage_path: string
    file_name: string
    file_format: string
    external_source: { bucket?: string } | null
  }

  // For PR 3 the recording must live in Supabase storage. PR 4 will add the
  // Drive-direct path for files we chose not to copy because of size.
  const bucket = row.external_source?.bucket
    ?? (row.storage_path && !row.external_source ? DOCUMENTS_BUCKET : null)
    ?? RECORDINGS_BUCKET
  if (!row.storage_path) {
    throw new Error('Recording has no Supabase storage_path (external-only sources land in PR 4)')
  }

  await admin
    .from('memo_agent_jobs')
    .update({ progress_message: `Generating signed URL (${bucket})` })
    .eq('id', job.id)

  const { data: signed, error: signErr } = await admin.storage
    .from(bucket)
    .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS)
  if (signErr || !signed?.signedUrl) {
    throw new Error(`Failed to sign recording URL: ${signErr?.message ?? 'unknown'}`)
  }

  const callbackUrl = resolveCallbackUrl()

  await admin
    .from('memo_agent_jobs')
    .update({ progress_message: 'Submitting to Deepgram' })
    .eq('id', job.id)

  const { request_id } = await submitForTranscription({
    source_url: signed.signedUrl,
    callback_url: callbackUrl,
    external_ref: job.id,
  })

  await admin
    .from('memo_agent_jobs')
    .update({
      external_job_id: request_id,
      progress_message: 'Awaiting Deepgram callback',
    })
    .eq('id', job.id)

  return { awaiting_callback: true, external_job_id: request_id, document_id: row.id }
}

function resolveCallbackUrl(): string {
  // Prefer explicit override (lets a dev tunnel point at localhost via ngrok).
  const explicit = process.env.TRANSCRIPTION_WEBHOOK_URL
  if (explicit) return explicit

  const base = process.env.NEXT_PUBLIC_SITE_URL
    ?? process.env.VERCEL_PROJECT_PRODUCTION_URL
    ?? process.env.VERCEL_URL
  if (!base) {
    throw new Error('No webhook base URL configured (set TRANSCRIPTION_WEBHOOK_URL or NEXT_PUBLIC_SITE_URL)')
  }
  const origin = base.startsWith('http') ? base : `https://${base}`
  const secret = process.env.TRANSCRIPTION_WEBHOOK_SECRET
  if (!secret) {
    throw new Error('TRANSCRIPTION_WEBHOOK_SECRET not configured')
  }
  // The shared secret lives in the URL path so Deepgram (which doesn't sign
  // request bodies for prerecorded callbacks) can be authenticated cheaply.
  return `${origin.replace(/\/$/, '')}/api/webhooks/transcription/${encodeURIComponent(secret)}`
}

export function isAwaitingCallback(value: unknown): value is AwaitingCallback {
  return !!value && typeof value === 'object' && (value as any).awaiting_callback === true
}
