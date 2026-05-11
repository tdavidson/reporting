import { createAdminClient } from '@/lib/supabase/admin'
import { runIngest } from '@/lib/memo-agent/stages/ingest'

type Admin = ReturnType<typeof createAdminClient>

interface IngestJob {
  id: string
  fund_id: string
  deal_id: string
  draft_id: string | null
  payload: Record<string, unknown>
}

/**
 * Worker entry point for the `ingest` kind of memo_agent_jobs row. Wraps
 * runIngest with progress writebacks so the UI can poll for status.
 */
export async function runIngestJob(admin: Admin, job: IngestJob): Promise<unknown> {
  const documentIds = Array.isArray(job.payload?.document_ids)
    ? (job.payload.document_ids as unknown[]).filter((x): x is string => typeof x === 'string')
    : undefined

  const result = await runIngest({
    admin,
    fundId: job.fund_id,
    dealId: job.deal_id,
    documentIds,
    draftId: job.draft_id ?? undefined,
    progressCb: async (msg) => {
      await admin
        .from('memo_agent_jobs')
        .update({ progress_message: msg })
        .eq('id', job.id)
    },
  })

  // Link the draft back to the job for cross-reference.
  if (result.draft_id && !job.draft_id) {
    await admin
      .from('memo_agent_jobs')
      .update({ draft_id: result.draft_id })
      .eq('id', job.id)
  }

  // Return a compact summary; the worker writes this to memo_agent_jobs.result.
  return {
    draft_id: result.draft_id,
    documents_processed: result.documents_processed,
    claims_extracted: result.ingestion_output.documents.reduce((acc, d) => acc + d.claims.length, 0),
    missing_documents: result.ingestion_output.gap_analysis.missing.length,
    inadequate_documents: result.ingestion_output.gap_analysis.inadequate.length,
    cross_doc_flags: result.ingestion_output.cross_doc_flags.length,
    warnings: result.warnings,
  }
}
