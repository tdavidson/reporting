import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runIngestJob } from '@/lib/memo-agent/jobs/ingest-job'
import { runResearchJob } from '@/lib/memo-agent/jobs/research-job'
import { runDraftJob } from '@/lib/memo-agent/jobs/draft-job'
import { runRenderJob } from '@/lib/memo-agent/jobs/render-job'

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
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const admin = createAdminClient()

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
    kind: 'ingest' | 'research' | 'qa' | 'draft' | 'render'
    payload: Record<string, unknown>
  }

  console.log(`[memo-agent-worker] claimed ${job.kind} job ${job.id} (deal ${job.deal_id})`)

  try {
    let result: unknown
    switch (job.kind) {
      case 'ingest':
        result = await runIngestJob(admin, job)
        break
      case 'research':
        result = await runResearchJob(admin, job)
        break
      case 'draft':
        result = await runDraftJob(admin, job)
        break
      case 'render':
        result = await runRenderJob(admin, job)
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
