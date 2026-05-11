import { createAdminClient } from '@/lib/supabase/admin'
import { logAIUsage } from '@/lib/ai/usage'
import { getStageProvider } from '@/lib/memo-agent/stage-provider'
import { buildSystemPrompt } from '@/lib/memo-agent/prompts/system'
import { buildResearchUserContent } from '@/lib/memo-agent/prompts/research'
import type { IngestionOutput } from './ingest'

type Admin = ReturnType<typeof createAdminClient>

export interface ResearchOutput {
  findings: Array<{
    id: string
    claim_ref: string | null
    topic: string
    verification_status: 'verified' | 'contradicted' | 'company_stated' | 'inconclusive'
    evidence: string
    sources: Array<{ title: string; url: string | null; tier: 'tier_1' | 'tier_2' | 'tier_3' }>
  }>
  contradictions: Array<{
    topic: string
    claim_ref: string | null
    description: string
    severity: 'material' | 'minor'
  }>
  competitive_map: {
    named_by_company: Array<{ name: string; note: string }>
    named_by_research: Array<{ name: string; rationale: string; sources: Array<{ title: string; url: string | null }> }>
  }
  founder_dossiers: Array<{
    founder_name: string
    role: string
    background_summary: string
    sources: Array<{ title: string; url: string | null }>
    open_questions: string[]
  }>
  research_gaps: Array<{ topic: string; rationale: string; criticality: 'blocker' | 'important' | 'nice_to_have' }>
  research_mode: 'with_web_search' | 'no_web_search'
}

export interface ResearchResult {
  draft_id: string
  research_output: ResearchOutput
  warnings: string[]
}

/**
 * Run Stage 2 — external research. Reads the existing draft's ingestion_output,
 * builds the research prompt, calls the AI, validates the response.
 *
 * Web search: when the fund has set `memo_agent_web_search_enabled = true` AND
 * the resolved research-stage provider is Anthropic, we attach the
 * `web_search_20250305` server-side tool. The prompt switches to the
 * "with web search" variant so the model is told to verify claims and cite
 * URLs. Other providers always get the no-web-search prompt path.
 */
export async function runResearch(params: {
  admin: Admin
  fundId: string
  dealId: string
  draftId?: string
  progressCb?: (msg: string) => Promise<void>
}): Promise<ResearchResult> {
  const { admin, fundId, dealId, progressCb } = params
  const note = async (msg: string) => { if (progressCb) await progressCb(msg) }

  await note('Loading ingestion output…')
  const draftRow = await loadDraftWithIngestion(admin, fundId, dealId, params.draftId)
  if (!draftRow) {
    throw new Error('No ingestion output found. Run Stage 1 ingest first.')
  }
  const ingestion = draftRow.ingestion_output as IngestionOutput

  await note('Loading deal record…')
  const { data: dealRow } = await admin
    .from('diligence_deals')
    .select('name')
    .eq('id', dealId)
    .eq('fund_id', fundId)
    .maybeSingle()
  const dealName = (dealRow as { name: string } | null)?.name ?? 'this deal'

  await note('Building research prompt…')
  const { prompt: system } = await buildSystemPrompt({ admin, fundId, stage: 'research' })

  await note('Calling AI provider for research…')
  const { provider, model, providerType, webSearchAvailable } = await getStageProvider(admin, fundId, 'research')

  const webSearchEnabled = webSearchAvailable
  const userContent = buildResearchUserContent({ dealName, ingestion, webSearchEnabled })

  let raw: string
  try {
    const { text, usage } = await provider.createMessage({
      model,
      maxTokens: 16384,
      system,
      content: userContent,
      enableWebSearch: webSearchEnabled,
    })
    raw = text
    logAIUsage(admin, {
      fundId,
      provider: providerType,
      model,
      feature: 'memo_agent_research',
      usage,
    })
  } catch (err) {
    throw new Error(`Research AI call failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  await note('Parsing research output…')
  const output = parseResearchResponse(raw)
  output.research_mode = webSearchEnabled ? 'with_web_search' : 'no_web_search'

  await note('Writing research output to draft…')
  const { error: updateErr } = await admin
    .from('diligence_memo_drafts')
    .update({ research_output: output as any })
    .eq('id', draftRow.id)
  if (updateErr) throw new Error(`Failed to update draft: ${updateErr.message}`)

  // Bump deal stage if currently in 'research'.
  await admin
    .from('diligence_deals')
    .update({ current_memo_stage: 'qa' })
    .eq('id', dealId)
    .eq('fund_id', fundId)
    .eq('current_memo_stage', 'research')

  return {
    draft_id: draftRow.id,
    research_output: output,
    warnings: [],
  }
}

// ---------------------------------------------------------------------------

async function loadDraftWithIngestion(
  admin: Admin,
  fundId: string,
  dealId: string,
  draftId?: string,
): Promise<{ id: string; ingestion_output: unknown } | null> {
  if (draftId) {
    const { data } = await admin
      .from('diligence_memo_drafts')
      .select('id, ingestion_output')
      .eq('id', draftId)
      .eq('fund_id', fundId)
      .maybeSingle()
    return (data as any) ?? null
  }

  const { data } = await admin
    .from('diligence_memo_drafts')
    .select('id, ingestion_output')
    .eq('deal_id', dealId)
    .eq('fund_id', fundId)
    .eq('is_draft', true)
    .not('ingestion_output', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as any) ?? null
}

function parseResearchResponse(raw: string): ResearchOutput {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Research AI returned non-JSON: ${cleaned.slice(0, 300)}`)
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Research AI returned non-object JSON')
  const obj = parsed as Record<string, unknown>

  return {
    findings: Array.isArray(obj.findings) ? obj.findings as any[] : [],
    contradictions: Array.isArray(obj.contradictions) ? obj.contradictions as any[] : [],
    competitive_map: {
      named_by_company: ((obj.competitive_map as any)?.named_by_company as any[]) ?? [],
      named_by_research: ((obj.competitive_map as any)?.named_by_research as any[]) ?? [],
    },
    founder_dossiers: Array.isArray(obj.founder_dossiers) ? obj.founder_dossiers as any[] : [],
    research_gaps: Array.isArray(obj.research_gaps) ? obj.research_gaps as any[] : [],
    research_mode: obj.research_mode === 'with_web_search' ? 'with_web_search' : 'no_web_search',
  }
}
