import { createAdminClient } from '@/lib/supabase/admin'
import { runResearch } from '@/lib/memo-agent/stages/research'

type Admin = ReturnType<typeof createAdminClient>

interface ResearchJob {
  id: string
  fund_id: string
  deal_id: string
  draft_id: string | null
  payload: Record<string, unknown>
}

export async function runResearchJob(admin: Admin, job: ResearchJob): Promise<unknown> {
  const result = await runResearch({
    admin,
    fundId: job.fund_id,
    dealId: job.deal_id,
    draftId: job.draft_id ?? undefined,
    progressCb: async (msg) => {
      await admin
        .from('memo_agent_jobs')
        .update({ progress_message: msg })
        .eq('id', job.id)
    },
  })

  if (result.draft_id && !job.draft_id) {
    await admin
      .from('memo_agent_jobs')
      .update({ draft_id: result.draft_id })
      .eq('id', job.id)
  }

  return {
    draft_id: result.draft_id,
    findings: result.research_output.findings.length,
    contradictions: result.research_output.contradictions.length,
    competitors_named_by_company: result.research_output.competitive_map.named_by_company.length,
    competitors_named_by_research: result.research_output.competitive_map.named_by_research.length,
    founder_dossiers: result.research_output.founder_dossiers.length,
    research_gaps: result.research_output.research_gaps.length,
    research_mode: result.research_output.research_mode,
    warnings: result.warnings,
  }
}
