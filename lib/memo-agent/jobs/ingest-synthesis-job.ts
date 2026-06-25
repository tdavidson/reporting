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
  // A full re-analyze flows through ingest → synthesis → checklist; carry the
  // flag so the checklist re-assesses every item, not just the open ones.
  const full = job.payload?.full === true
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

  // Auto-enqueue checklist_assessment when the deal has a partner checklist.
  // Skipping silently when there is none — many funds may use the agent
  // without ever building a checklist.
  let checklist_job_id: string | null = null
  const { count: checklistCount } = await (admin as any)
    .from('diligence_checklist_items')
    .select('id', { count: 'exact', head: true })
    .eq('deal_id', job.deal_id)
    .eq('fund_id', job.fund_id)
    .eq('kind', 'item')
  if ((checklistCount ?? 0) > 0) {
    const { data: enq, error: enqErr } = await admin
      .from('memo_agent_jobs')
      .insert({
        fund_id: job.fund_id,
        deal_id: job.deal_id,
        draft_id: result.draft_id,
        kind: 'checklist_assessment',
        payload: full ? { all: true } : {},
      } as any)
      .select('id')
      .single()
    if (!enqErr && enq) checklist_job_id = (enq as { id: string }).id
  }

  return {
    draft_id: result.draft_id,
    missing_documents: result.gap_analysis.missing.length,
    inadequate_documents: result.gap_analysis.inadequate.length,
    cross_doc_flags: result.cross_doc_flags.length,
    checklist_job_id,
    warnings: result.warnings,
  }
}
