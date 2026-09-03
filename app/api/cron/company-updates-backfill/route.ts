import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runBackfillBatch } from '@/lib/company-updates/backfill'

export const maxDuration = 300

/**
 * Company Updates backfill worker. Each tick advances every running job by a bounded batch,
 * inside a time budget that fits the function ceiling; whatever is left waits for the next tick.
 * Items are claimed with SKIP LOCKED, so an operator running scripts/backfill-company-updates.ts
 * at the same time only speeds the job up.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: jobs, error } = await admin
    .from('company_update_backfill_jobs' as any)
    .select('id, fund_id')
    .eq('status', 'running')
    .order('created_at', { ascending: true })
    .limit(5)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const started = Date.now()
  const perJobBudget = Math.floor(240_000 / Math.max((jobs ?? []).length, 1))
  const outcomes: Array<Record<string, unknown>> = []
  for (const job of ((jobs ?? []) as unknown) as Array<{ id: string; fund_id: string }>) {
    if (Date.now() - started > 240_000) break
    try {
      const outcome = await runBackfillBatch({ admin: admin as any }, { jobId: job.id, maxItems: 40, timeBudgetMs: perJobBudget })
      outcomes.push({ job_id: job.id, claimed: outcome.claimed, done: outcome.done, failed: outcome.failed, retried: outcome.retried, status: outcome.job.status })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[cron/company-updates-backfill] job ${job.id} failed:`, err)
      await admin
        .from('company_update_backfill_jobs' as any)
        .update({ last_error: message, updated_at: new Date().toISOString() })
        .eq('id', job.id)
        .eq('fund_id', job.fund_id)
      outcomes.push({ job_id: job.id, error: message })
    }
  }
  return NextResponse.json({ jobs: outcomes })
}
