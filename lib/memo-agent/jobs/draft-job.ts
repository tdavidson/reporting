import { createAdminClient } from '@/lib/supabase/admin'
import { runDraft } from '@/lib/memo-agent/stages/draft'
import { runScore } from '@/lib/memo-agent/stages/score'

type Admin = ReturnType<typeof createAdminClient>

interface DraftJob {
  id: string
  fund_id: string
  deal_id: string
  draft_id: string | null
  payload: Record<string, unknown>
}

/**
 * Stage 4 + 5 — drafting and scoring run together. They share the same
 * underlying input data and would always be invoked back-to-back, so a
 * single job runs both. On scoring failure we keep the draft.
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

  let scoreResult: Awaited<ReturnType<typeof runScore>> | null = null
  let scoreError: string | null = null
  try {
    scoreResult = await runScore({
      admin,
      fundId: job.fund_id,
      dealId: job.deal_id,
      draftId: draftResult.draft_id,
      progressCb: async (msg) => {
        await admin.from('memo_agent_jobs').update({ progress_message: `Scoring: ${msg}` }).eq('id', job.id)
      },
    })
  } catch (err) {
    scoreError = err instanceof Error ? err.message : String(err)
  }

  // Bump deal stage to 'render' (or 'score' if scoring failed).
  await admin
    .from('diligence_deals')
    .update({ current_memo_stage: scoreError ? 'score' : 'render' })
    .eq('id', job.deal_id)
    .eq('fund_id', job.fund_id)

  return {
    draft_id: draftResult.draft_id,
    paragraphs: draftResult.output.paragraphs.length,
    partner_attention_items: draftResult.output.partner_attention.length,
    scores: scoreResult?.output.scores.length ?? 0,
    low_confidence_dimensions: scoreResult?.output.low_confidence_attention.length ?? 0,
    score_error: scoreError,
    warnings: draftResult.warnings,
  }
}
