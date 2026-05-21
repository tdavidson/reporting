import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runIngestJob } from '@/lib/memo-agent/jobs/ingest-job'
import { runIngestSynthesisJob } from '@/lib/memo-agent/jobs/ingest-synthesis-job'
import { runResearchJob } from '@/lib/memo-agent/jobs/research-job'
import { runDraftJob } from '@/lib/memo-agent/jobs/draft-job'
import { runDraftReviewJob } from '@/lib/memo-agent/jobs/draft-review-job'
import { runScoreJob } from '@/lib/memo-agent/jobs/score-job'
import { runRenderJob } from '@/lib/memo-agent/jobs/render-job'
import { runTranscribeJob, isAwaitingCallback } from '@/lib/memo-agent/jobs/transcribe-job'

/**
 * Memo Agent worker. Triggered by Vercel cron every minute (per
 * BUILD_PLAN_FOR_CLAUDE_CODE.md decision). Claims one pending job from
 * `memo_agent_jobs`, dispatches it to the right stage handler, and writes
 * the outcome back. Designed to fit comfortably inside a 120s function
 * — long stages must internally chunk to that ceiling.
 *
 * Auth: same `Authorization: Bearer ${CRON_SECRET}` pattern as the
 * deals-digest cron.
 */
export async function GET(req: NextRequest) {
  // Fail-closed: an unset CRON_SECRET means the endpoint refuses traffic.
  // The prior "if cronSecret then check" pattern silently opened the worker
  // to anonymous callers in any environment where the env var wasn't set
  // (PR previews, staging, misconfigured prod).
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Self-heal: any job stuck in `running` past the function ceiling was killed
  // by Vercel mid-stage and will never finish on its own. Fail them so the UI
  // unblocks and the user can retry without manual DB edits. The cutoff has to
  // be at least the worker's maxDuration (300s in vercel.json) plus headroom,
  // or we'll kill jobs that are still alive — 6m gives a clean buffer.
  // Transcribe jobs with an external_job_id are legitimately awaiting a
  // provider callback and can take much longer than a Vercel function — they
  // get a separate, looser timeout below.
  const STALE_RUNNING_MS = 6 * 60 * 1000
  const staleCutoff = new Date(Date.now() - STALE_RUNNING_MS).toISOString()
  await admin
    .from('memo_agent_jobs')
    .update({
      status: 'failed',
      error: 'killed: worker timed out (no progress for >6m)',
      finished_at: new Date().toISOString(),
      progress_message: 'killed: timeout',
    } as any)
    .eq('status', 'running')
    .is('external_job_id', null)
    .lt('started_at', staleCutoff)

  // Transcribe jobs stuck awaiting an external callback for >1h are presumed
  // lost (Deepgram didn't call back, our webhook 500'd, etc).
  const STALE_CALLBACK_MS = 60 * 60 * 1000
  const callbackCutoff = new Date(Date.now() - STALE_CALLBACK_MS).toISOString()
  await admin
    .from('memo_agent_jobs')
    .update({
      status: 'failed',
      error: 'killed: external callback never arrived (>1h)',
      finished_at: new Date().toISOString(),
      progress_message: 'killed: callback timeout',
    } as any)
    .eq('status', 'running')
    .not('external_job_id', 'is', null)
    .lt('started_at', callbackCutoff)

  // Atomically claim the next pending job using the SQL helper.
  const { data: claimed, error: claimErr } = await (admin as any)
    .rpc('memo_agent_claim_next_job') as { data: any; error: any }

  if (claimErr) {
    console.error('[memo-agent-worker] claim error:', claimErr)
    return NextResponse.json({ error: claimErr.message }, { status: 500 })
  }
  if (!claimed || !claimed.id) {
    return NextResponse.json({ ok: true, idle: true })
  }

  const job = claimed as {
    id: string
    fund_id: string
    deal_id: string
    draft_id: string | null
    kind: 'ingest' | 'ingest_synthesis' | 'research' | 'qa' | 'draft' | 'draft_review' | 'score' | 'render' | 'transcribe'
    payload: Record<string, unknown>
    enqueued_by: string | null
  }

  console.log(`[memo-agent-worker] claimed ${job.kind} job ${job.id} (deal ${job.deal_id})`)

  try {
    let result: unknown
    switch (job.kind) {
      case 'ingest':
        result = await runIngestJob(admin, job)
        break
      case 'ingest_synthesis':
        result = await runIngestSynthesisJob(admin, job)
        break
      case 'research':
        result = await runResearchJob(admin, job)
        break
      case 'draft':
        result = await runDraftJob(admin, job)
        break
      case 'draft_review':
        result = await runDraftReviewJob(admin, job)
        break
      case 'score':
        result = await runScoreJob(admin, job)
        break
      case 'render':
        result = await runRenderJob(admin, job)
        break
      case 'transcribe':
        result = await runTranscribeJob(admin, job)
        break
      case 'qa':
        // Q&A is a synchronous interactive flow rather than a worker job —
        // it shouldn't appear here, but we mark it as failed if it does.
        await markFailed(admin, job.id, 'Q&A is run interactively; no worker job needed.')
        return NextResponse.json({ ok: true, jobId: job.id, status: 'failed', reason: 'qa is interactive' })
      default:
        await markFailed(admin, job.id, `Unknown job kind: ${job.kind}`)
        return NextResponse.json({ ok: true, jobId: job.id, status: 'failed', reason: 'unknown kind' })
    }

    // Async jobs that submitted work to an external provider stay in
    // `running` until the provider's webhook finishes the job.
    if (isAwaitingCallback(result)) {
      return NextResponse.json({ ok: true, jobId: job.id, status: 'awaiting_callback' })
    }

    await admin
      .from('memo_agent_jobs')
      .update({
        status: 'success',
        result: result as any,
        finished_at: new Date().toISOString(),
        progress_message: 'completed',
      })
      .eq('id', job.id)

    return NextResponse.json({ ok: true, jobId: job.id, status: 'success' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[memo-agent-worker] ${job.kind} job ${job.id} failed:`, err)
    await markFailed(admin, job.id, message)
    return NextResponse.json({ ok: true, jobId: job.id, status: 'failed', error: message })
  }
}

async function markFailed(admin: ReturnType<typeof createAdminClient>, id: string, error: string) {
  await admin
    .from('memo_agent_jobs')
    .update({
      status: 'failed',
      error,
      finished_at: new Date().toISOString(),
      progress_message: 'failed',
    })
    .eq('id', id)
}
