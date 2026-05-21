import { createAdminClient } from '@/lib/supabase/admin'
import { runIngestDocs } from '@/lib/memo-agent/stages/ingest'

type Admin = ReturnType<typeof createAdminClient>

interface IngestJob {
  id: string
  fund_id: string
  deal_id: string
  draft_id: string | null
  payload: Record<string, unknown>
  enqueued_by?: string | null
}

/**
 * Worker entry point for the `ingest` kind. Runs the per-document fan-out
 * via runIngestDocs, persists per-doc results to the draft, and enqueues
 * a follow-up `ingest_synthesis` job so cross-doc analysis runs on its own
 * 300s budget. Splitting the work in two is what keeps multi-doc data rooms
 * from orphaning at the Vercel function ceiling.
 */
export async function runIngestJob(admin: Admin, job: IngestJob): Promise<unknown> {
  const documentIds = Array.isArray(job.payload?.document_ids)
    ? (job.payload.document_ids as unknown[]).filter((x): x is string => typeof x === 'string')
    : undefined

  const result = await runIngestDocs({
    admin,
    fundId: job.fund_id,
    dealId: job.deal_id,
    documentIds,
    draftId: job.draft_id ?? undefined,
    progressCb: async (msg) => {
      await admin
        .from('memo_agent_jobs')
        .update({ progress_message: msg } as any)
        .eq('id', job.id)
    },
  })

  if (result.draft_id && !job.draft_id) {
    await admin
      .from('memo_agent_jobs')
      .update({ draft_id: result.draft_id } as any)
      .eq('id', job.id)
  }

  // Auto-enqueue the synthesis follow-up. The worker picks it up on the next
  // cron tick (~within a minute). Skipping if there are zero docs processed —
  // synthesis has nothing to do in that case.
  let synthesis_job_id: string | null = null
  if (result.documents_processed > 0) {
    const { data: enq, error: enqErr } = await admin
      .from('memo_agent_jobs')
      .insert({
        fund_id: job.fund_id,
        deal_id: job.deal_id,
        draft_id: result.draft_id,
        kind: 'ingest_synthesis',
        payload: {},
        enqueued_by: job.enqueued_by ?? null,
      } as any)
      .select('id')
      .single()
    // Fail loudly rather than silently landing per-doc results with no
    // gap analysis / cross-doc flags.
    if (enqErr || !enq) {
      throw new Error(
        `Ingest succeeded but the synthesis job could not be enqueued: ${enqErr?.message ?? 'unknown error'}. ` +
        `If this mentions a check constraint on "kind", apply the memo_agent_jobs kind migration (supabase db push).`
      )
    }
    synthesis_job_id = (enq as { id: string }).id
  }

  return {
    draft_id: result.draft_id,
    documents_processed: result.documents_processed,
    claims_extracted: result.ingestion_documents.reduce((acc, d) => acc + d.claims.length, 0),
    synthesis_job_id,
    warnings: result.warnings,
  }
}
