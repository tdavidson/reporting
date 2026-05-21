import { createAdminClient } from '@/lib/supabase/admin'
import { runIngestSynthesis } from '@/lib/memo-agent/stages/ingest'

type Admin = ReturnType<typeof createAdminClient>

interface IngestSynthesisJob {
  id: string
  fund_id: string
  deal_id: string
  draft_id: string | null
  payload: Record<string, unknown>
}

/**
 * Worker entry point for the `ingest_synthesis` kind. Reads the per-document
 * results from the latest draft, runs the cross-doc synthesis AI call, and
 * writes gap_analysis + cross_doc_flags back to the draft.
 *
 * This is auto-enqueued by the ingest job on success — partners do not
 * trigger it directly.
 */
export async function runIngestSynthesisJob(admin: Admin, job: IngestSynthesisJob): Promise<unknown> {
  const result = await runIngestSynthesis({
    admin,
    fundId: job.fund_id,
    dealId: job.deal_id,
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

  return {
    draft_id: result.draft_id,
    missing_documents: result.gap_analysis.missing.length,
    inadequate_documents: result.gap_analysis.inadequate.length,
    cross_doc_flags: result.cross_doc_flags.length,
    warnings: result.warnings,
  }
}
