import { createAdminClient } from '@/lib/supabase/admin'
import { runDraftReview } from '@/lib/memo-agent/stages/draft'
import { runScore } from '@/lib/memo-agent/stages/score'

type Admin = ReturnType<typeof createAdminClient>

interface DraftReviewJob {
  id: string
  fund_id: string
  deal_id: string
  draft_id: string | null
  payload: Record<string, unknown>
}

/**
 * Stage 4C + 5 — review/edit pass followed by rubric scoring.
 *
 * Auto-enqueued by the draft job. Review and score are independent failure
 * domains: a failed review pass must NOT block scoring, because score only
 * needs the persisted draft (which already exists from the draft job) — not
 * the review edits. Each is wrapped separately and surfaces its own error.
 */
export async function runDraftReviewJob(admin: Admin, job: DraftReviewJob): Promise<unknown> {
  const progress = async (msg: string) => {
    await admin.from('memo_agent_jobs').update({ progress_message: msg }).eq('id', job.id)
  }

  // ---- Review pass (best-effort) ----------------------------------------
  let reviewResult: Awaited<ReturnType<typeof runDraftReview>> | null = null
  let reviewError: string | null = null
  try {
    reviewResult = await runDraftReview({
      admin,
      fundId: job.fund_id,
      dealId: job.deal_id,
      draftId: job.draft_id ?? undefined,
      progressCb: progress,
    })
  } catch (err) {
    reviewError = err instanceof Error ? err.message : String(err)
  }

  // draft_id: prefer the review result, fall back to the job row's own
  // draft_id (set by the draft job at enqueue time). Scoring can still run
  // off the persisted first draft even when review failed entirely.
  const draftId = reviewResult?.draft_id ?? job.draft_id
  if (!draftId) {
    throw new Error(
      `No draft_id available for scoring. Review error: ${reviewError ?? 'none'}.`
    )
  }
  if (reviewResult?.draft_id && !job.draft_id) {
    await admin.from('memo_agent_jobs').update({ draft_id: reviewResult.draft_id }).eq('id', job.id)
  }

  // ---- Scoring (best-effort, always attempted) --------------------------
  let scoreResult: Awaited<ReturnType<typeof runScore>> | null = null
  let scoreError: string | null = null
  try {
    scoreResult = await runScore({
      admin,
      fundId: job.fund_id,
      dealId: job.deal_id,
      draftId,
      progressCb: async (msg) => { await progress(`Scoring: ${msg}`) },
    })
  } catch (err) {
    scoreError = err instanceof Error ? err.message : String(err)
  }

  // Bump deal stage to 'render' (or 'score' if scoring failed). Only advance
  // from 'draft' — don't regress a deal that's already further along.
  await admin
    .from('diligence_deals')
    .update({ current_memo_stage: scoreError ? 'score' : 'render' })
    .eq('id', job.deal_id)
    .eq('fund_id', job.fund_id)
    .eq('current_memo_stage', 'draft')

  const warnings = [
    ...(reviewResult?.warnings ?? []),
    ...(reviewError ? [`Review pass failed: ${reviewError}. Scoring ran on the un-reviewed draft.`] : []),
  ]

  return {
    draft_id: draftId,
    edits_applied: reviewResult?.edits_applied ?? 0,
    review_error: reviewError,
    scores: scoreResult?.output.scores.length ?? 0,
    low_confidence_dimensions: scoreResult?.output.low_confidence_attention.length ?? 0,
    score_error: scoreError,
    warnings,
  }
}
