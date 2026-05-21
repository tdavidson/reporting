import { createAdminClient } from '@/lib/supabase/admin'
import { runDraft } from '@/lib/memo-agent/stages/draft'

type Admin = ReturnType<typeof createAdminClient>

interface DraftJob {
  id: string
  fund_id: string
  deal_id: string
  draft_id: string | null
  payload: Record<string, unknown>
  enqueued_by?: string | null
}

/**
 * Stage 4 — drafting (outline + parallel section fills).
 *
 * On success, auto-enqueues a `draft_review` job which runs the review/edit
 * pass and rubric scoring. Splitting the work keeps each job inside the 300s
 * function ceiling: outline + fills here, review + score there.
 */
export async function runDraftJob(admin: Admin, job: DraftJob): Promise<unknown> {
  const draftResult = await runDraft({
    admin,
    fundId: job.fund_id,
    dealId: job.deal_id,
    draftId: job.draft_id ?? undefined,
    progressCb: async (msg) => {
      await admin.from('memo_agent_jobs').update({ progress_message: msg }).eq('id', job.id)
    },
  })

  if (draftResult.draft_id && !job.draft_id) {
    await admin.from('memo_agent_jobs').update({ draft_id: draftResult.draft_id }).eq('id', job.id)
  }

  // Auto-enqueue the review + score follow-up. Skipped only if the draft
  // produced nothing (every fill batch failed) — there's nothing to review.
  let review_job_id: string | null = null
  if (draftResult.output.paragraphs.length > 0) {
    const { data: enq, error: enqErr } = await admin
      .from('memo_agent_jobs')
      .insert({
        fund_id: job.fund_id,
        deal_id: job.deal_id,
        draft_id: draftResult.draft_id,
        kind: 'draft_review',
        payload: {},
        enqueued_by: job.enqueued_by ?? null,
      } as any)
      .select('id')
      .single()
    // Fail loudly if the follow-up can't be scheduled — otherwise the memo
    // silently lands with no review pass and no scoring. The draft prose is
    // already persisted, so re-running after the fix is safe.
    if (enqErr || !enq) {
      throw new Error(
        `Draft succeeded but the review + score job could not be enqueued: ${enqErr?.message ?? 'unknown error'}. ` +
        `If this mentions a check constraint on "kind", apply migration ` +
        `20260520000000_memo_agent_jobs_draft_review_kind.sql (supabase db push), then re-run the draft.`
      )
    }
    review_job_id = (enq as { id: string }).id
  }

  return {
    draft_id: draftResult.draft_id,
    paragraphs: draftResult.output.paragraphs.length,
    partner_attention_items: draftResult.output.partner_attention.length,
    review_job_id,
    warnings: draftResult.warnings,
  }
}
