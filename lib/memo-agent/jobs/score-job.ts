import { createAdminClient } from '@/lib/supabase/admin'
import { runScore } from '@/lib/memo-agent/stages/score'

type Admin = ReturnType<typeof createAdminClient>

interface ScoreJob {
  id: string
  fund_id: string
  deal_id: string
  draft_id: string | null
  payload: Record<string, unknown>
}

/**
 * Stage 5 — standalone rubric scoring.
 *
 * Scores an existing memo draft without re-running draft/review. Targets the
 * job's draft_id when set, else the most recent draft that already has a
 * memo_draft_output. Used by the "Run scoring" action and as the retry path
 * when the inline score (in draft_review) failed.
 */
export async function runScoreJob(admin: Admin, job: ScoreJob): Promise<unknown> {
  let draftId = job.draft_id
  if (!draftId) {
    const { data } = await admin
      .from('diligence_memo_drafts')
      .select('id')
      .eq('deal_id', job.deal_id)
      .eq('fund_id', job.fund_id)
      .eq('is_draft', true)
      .not('memo_draft_output', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    draftId = (data as { id: string } | null)?.id ?? null
  }
  if (!draftId) {
    throw new Error('No draft with a memo_draft_output found to score. Run Stage 4 draft first.')
  }

  const result = await runScore({
    admin,
    fundId: job.fund_id,
    dealId: job.deal_id,
    draftId,
    progressCb: async (msg) => {
      await admin.from('memo_agent_jobs').update({ progress_message: msg }).eq('id', job.id)
    },
  })

  if (!job.draft_id) {
    await admin.from('memo_agent_jobs').update({ draft_id: draftId }).eq('id', job.id)
  }

  // Advance the deal to 'render' once it has been scored — only from 'score'
  // or 'draft', so a later stage isn't regressed.
  await admin
    .from('diligence_deals')
    .update({ current_memo_stage: 'render' })
    .eq('id', job.deal_id)
    .eq('fund_id', job.fund_id)
    .in('current_memo_stage', ['draft', 'score'])

  return {
    draft_id: draftId,
    scores: result.output.scores.length,
    low_confidence_dimensions: result.output.low_confidence_attention.length,
  }
}
