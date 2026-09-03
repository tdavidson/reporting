// Operator backfill of the Company Updates projection.
//
//   npx tsx --env-file=.env.local scripts/backfill-company-updates.ts --fund <fund_id> --dry-run
//   npx tsx --env-file=.env.local scripts/backfill-company-updates.ts --fund <fund_id> --sample 25 [--company <company_id>]
//   npx tsx --env-file=.env.local scripts/backfill-company-updates.ts --fund <fund_id> --full [--reprocess] [--concurrency 3]
//   npx tsx --env-file=.env.local scripts/backfill-company-updates.ts --resume <job_id> [--retry-failed]
//   npx tsx --env-file=.env.local scripts/backfill-company-updates.ts --status <job_id>
//   npx tsx --env-file=.env.local scripts/backfill-company-updates.ts --fund <fund_id> --ocr [limit]
//     (drains the fund's OCR queue with its configured vision model — this spends model tokens)
//
// Resumable: a job's items live in company_update_backfill_items; re-running with --resume claims
// whatever is still pending (including transient failures returned to the queue). Safe alongside
// the cron worker — both claim with SKIP LOCKED. --reprocess re-captures emails already at the
// current parser version; without it they are skipped. Never applies migrations or touches the
// source emails; it only writes the projection.

import { createAdminClient } from '@/lib/supabase/admin'
import { CAPTURE_VERSION } from '@/lib/company-updates/extraction'
import { runOcrBatch } from '@/lib/company-updates/ocr'
import {
  backfillStatus,
  createBackfillJob,
  planBackfillJob,
  retryFailedItems,
  runBackfillBatch,
  type BackfillMode,
} from '@/lib/company-updates/backfill'

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}
const flag = (name: string) => process.argv.includes(`--${name}`)

async function main() {
  const admin: any = createAdminClient()
  const statusId = arg('status')
  const resumeId = arg('resume')
  const fundId = arg('fund')

  if (statusId) {
    const { data: job } = await admin.from('company_update_backfill_jobs').select('fund_id').eq('id', statusId).maybeSingle()
    if (!job) throw new Error(`Job ${statusId} not found`)
    print(await backfillStatus(admin, { fundId: job.fund_id, jobId: statusId }))
    return
  }

  if (flag('ocr')) {
    if (!fundId) throw new Error('--fund <fund_id> is required with --ocr')
    const limit = Number.parseInt(arg('ocr') ?? '', 10) || 10
    let totals = { claimed: 0, completed: 0, failed: 0, retried: 0 }
    for (;;) {
      const result = await runOcrBatch(admin, { fundId, limit: Math.min(limit - totals.claimed, 5) })
      totals = { claimed: totals.claimed + result.claimed, completed: totals.completed + result.completed, failed: totals.failed + result.failed, retried: totals.retried + result.retried }
      for (const d of result.details) console.log(`  ${d.artifactId}: ${d.outcome}${d.error ? ` — ${d.error}` : ''}`)
      if (result.claimed === 0 || totals.claimed >= limit) break
    }
    console.log('OCR totals:', totals)
    return
  }

  let jobId = resumeId
  if (jobId && flag('retry-failed')) {
    const { data: job } = await admin.from('company_update_backfill_jobs').select('fund_id').eq('id', jobId).maybeSingle()
    if (!job) throw new Error(`Job ${jobId} not found`)
    const requeued = await retryFailedItems(admin, { jobId, fundId: job.fund_id })
    console.log(`Requeued ${requeued} failed item(s).`)
  }
  if (jobId) {
    // Planning is keyset-resumable: finish enumerating before claiming work. For a dry run this IS
    // the whole job.
    console.log(`Job ${jobId}: resuming plan…`)
    const planned = await planBackfillJob({ admin }, jobId)
    console.log(`Planned ${planned.planned} item(s) of ${planned.total_eligible} eligible.`)
    print(planned.counts)
    if (planned.status === 'completed') {
      console.log(planned.mode === 'dry_run' ? 'Dry run complete — nothing was written.' : 'Nothing left to process.')
      return
    }
  }
  if (!jobId) {
    if (!fundId) throw new Error('--fund <fund_id> is required (or --resume/--status <job_id>)')
    const mode: BackfillMode = flag('dry-run') ? 'dry_run' : arg('sample') ? 'sample' : flag('full') ? 'full' : 'dry_run'
    const sampleLimit = arg('sample') ? Number.parseInt(arg('sample')!, 10) : null
    console.log(`Creating ${mode} backfill for fund ${fundId} at parser ${CAPTURE_VERSION}${flag('reprocess') ? ' (reprocess)' : ''}…`)
    const job = await createBackfillJob({ admin }, {
      fundId,
      mode,
      reprocess: flag('reprocess'),
      sampleCompanyId: arg('company'),
      sampleLimit,
      concurrency: arg('concurrency') ? Number.parseInt(arg('concurrency')!, 10) : 3,
    })
    jobId = job.id
    console.log(`Job ${jobId}: planning…`)
    const planned = await planBackfillJob({ admin }, jobId)
    console.log(`Planned ${planned.planned} item(s) of ${planned.total_eligible} eligible.`)
    print(planned.counts)
    if (planned.status === 'completed') {
      console.log(mode === 'dry_run' ? 'Dry run complete — nothing was written.' : 'Nothing to process.')
      return
    }
  }

  let total = { claimed: 0, done: 0, failed: 0, retried: 0 }
  for (;;) {
    const outcome = await runBackfillBatch({ admin }, { jobId: jobId!, maxItems: 50, timeBudgetMs: 5 * 60_000 })
    total = {
      claimed: total.claimed + outcome.claimed,
      done: total.done + outcome.done,
      failed: total.failed + outcome.failed,
      retried: total.retried + outcome.retried,
    }
    const items = (outcome.job.counts as any)?.items ?? {}
    console.log(`  batch: +${outcome.claimed} claimed, ${outcome.done} done, ${outcome.failed} failed, ${outcome.retried} retried | job: ${items.done ?? 0} done / ${items.failed ?? 0} failed / ${items.pending ?? 0} pending`)
    if (outcome.job.status !== 'running' || outcome.claimed === 0) break
  }

  const { data: job } = await admin.from('company_update_backfill_jobs').select('fund_id').eq('id', jobId).maybeSingle()
  const status = await backfillStatus(admin, { fundId: job.fund_id, jobId: jobId! })
  console.log(`\nJob ${jobId} is ${status?.job.status}. Session totals:`, total)
  print({ items: status?.items, by_status: status?.by_status, by_format: status?.by_format, periods_recovered: status?.periods_recovered, recent_errors: status?.recent_errors })
}

function print(value: unknown) {
  console.log(JSON.stringify(value, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
