import { createAdminClient } from '@/lib/supabase/admin'
import { logAIUsage } from '@/lib/ai/usage'
import { getStageProvider } from '@/lib/memo-agent/stage-provider'
import { buildSystemPrompt } from '@/lib/memo-agent/prompts/system'
import {
  buildResearchClaimsContent,
  buildResearchCompetitorsContent,
  buildResearchFoundersContent,
} from '@/lib/memo-agent/prompts/research'
import { extractJsonObject } from '@/lib/memo-agent/parse-ai-json'
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
 * Run Stage 2 — external research.
 *
 * Fans out 3 AI sub-calls in parallel:
 *   1. Claims verification → findings + contradictions + research_gaps
 *   2. Competitive map     → named_by_company + named_by_research
 *   3. Founder dossiers    → founder_dossiers
 *
 * Each sub-call gets its own focused prompt, ingestion subset, and output
 * budget. A single sub-call failure surfaces as a warning while the other
 * two still produce output — replacing the prior all-or-nothing single call
 * that orphaned via max_tokens truncation on large data rooms.
 *
 * Web search: when the fund has set `memo_agent_web_search_enabled = true`
 * AND the resolved research-stage provider is Anthropic, the web_search tool
 * is attached to the 3 sub-calls. Other providers always get the no-web-search
 * prompt variant.
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
  const warnings: string[] = []

  await note('Loading ingestion output…')
  const draftRow = await loadDraftWithIngestion(admin, fundId, dealId, params.draftId)
  if (!draftRow) {
    throw new Error('No ingestion output found. Run Stage 1 ingest first.')
  }
  const ingestion = draftRow.ingestion_output as IngestionOutput
  const docCount = ingestion.documents?.length ?? 0
  const claimCount = ingestion.documents?.reduce((acc, d) => acc + (d.claims?.length ?? 0), 0) ?? 0

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

  const { provider, model, providerType, webSearchAvailable, webSearchOptIn } = await getStageProvider(admin, fundId, 'research')
  const webSearchEnabled = webSearchAvailable
  const promptInput = { dealName, ingestion, webSearchEnabled }

  // The fund opted into web search but it can't run — research isn't on
  // Anthropic. Surface this loudly: it's the most common reason web search
  // "didn't work".
  if (webSearchOptIn && !webSearchAvailable) {
    warnings.push(
      `Web search is enabled in settings but the research stage is not running on Anthropic ` +
      `(web search only works with Anthropic). It was skipped — set the research-stage provider ` +
      `to Anthropic, or the fund default to Anthropic.`
    )
  }

  await note(`Running 3 research sub-calls in parallel (${docCount} docs, ${claimCount} claims${webSearchEnabled ? ', web search on' : ''})…`)

  // Total server-side web searches performed across all sub-calls — lets us
  // tell "tool attached but model didn't search" from "searched, found little".
  let totalWebSearches = 0

  // Sub-call helper — runs one focused AI call, logs usage, parses JSON.
  // Each catches its own errors so a single failure doesn't kill siblings.
  type SubCall<T> = { name: string; content: any; maxTokens: number; parse: (obj: Record<string, unknown>) => T; fallback: T }
  const runSubCall = async <T>(s: SubCall<T>): Promise<T> => {
    try {
      const { text, usage, webSearchCount } = await provider.createMessage({
        model,
        maxTokens: s.maxTokens,
        system,
        content: s.content,
        enableWebSearch: webSearchEnabled,
      })
      if (typeof webSearchCount === 'number') totalWebSearches += webSearchCount
      logAIUsage(admin, {
        fundId,
        provider: providerType,
        model,
        feature: `memo_agent_research_${s.name}`,
        usage,
      })
      const parsed = extractJsonObject(text)
      if (!parsed || typeof parsed !== 'object') {
        throw new Error(`${s.name} returned non-object JSON`)
      }
      return s.parse(parsed as Record<string, unknown>)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      warnings.push(`Research sub-call "${s.name}" failed: ${msg}`)
      return s.fallback
    }
  }

  const [claimsResult, competitorsResult, foundersResult] = await Promise.all([
    runSubCall({
      name: 'claims',
      content: buildResearchClaimsContent(promptInput),
      // Claims is the heaviest output (findings + contradictions + gaps).
      // 24K leaves headroom even for large data rooms.
      maxTokens: 24576,
      parse: (obj) => ({
        findings: Array.isArray(obj.findings) ? obj.findings as ResearchOutput['findings'] : [],
        contradictions: Array.isArray(obj.contradictions) ? obj.contradictions as ResearchOutput['contradictions'] : [],
        research_gaps: Array.isArray(obj.research_gaps) ? obj.research_gaps as ResearchOutput['research_gaps'] : [],
      }),
      fallback: { findings: [], contradictions: [], research_gaps: [] },
    }),
    runSubCall({
      name: 'competitors',
      content: buildResearchCompetitorsContent(promptInput),
      maxTokens: 6144,
      parse: (obj) => {
        const cm = (obj.competitive_map as any) ?? {}
        return {
          named_by_company: Array.isArray(cm.named_by_company) ? cm.named_by_company : [],
          named_by_research: Array.isArray(cm.named_by_research) ? cm.named_by_research : [],
        }
      },
      fallback: { named_by_company: [], named_by_research: [] },
    }),
    runSubCall({
      name: 'founders',
      content: buildResearchFoundersContent(promptInput),
      maxTokens: 8192,
      parse: (obj) => Array.isArray(obj.founder_dossiers) ? obj.founder_dossiers as ResearchOutput['founder_dossiers'] : [],
      fallback: [] as ResearchOutput['founder_dossiers'],
    }),
  ])

  const output: ResearchOutput = {
    findings: claimsResult.findings,
    contradictions: claimsResult.contradictions,
    competitive_map: competitorsResult,
    founder_dossiers: foundersResult,
    research_gaps: claimsResult.research_gaps,
    research_mode: webSearchEnabled ? 'with_web_search' : 'no_web_search',
  }

  // Sanity checks — empty outputs become warnings, not failures, so a partial
  // result is still persisted and the partner can decide whether to re-run.
  if (output.findings.length === 0 && claimCount > 0) {
    warnings.push(`Research produced 0 findings despite ${claimCount} ingested claims. Model may have ignored the prompt — consider re-running.`)
  }
  if (webSearchEnabled) {
    if (totalWebSearches === 0) {
      warnings.push(
        'Web search was attached but the model performed 0 searches. ' +
        'Verify web search is enabled on the Anthropic account, or that the research prompt instructs the model to search.'
      )
    } else if (output.findings.length > 0 && output.findings.every(f => f.sources.length === 0)) {
      warnings.push(`Web search ran (${totalWebSearches} searches) but no finding carries a sourced URL — the model may not be citing what it found.`)
    }
  }

  await note('Writing research output to draft…')
  const { error: updateErr } = await admin
    .from('diligence_memo_drafts')
    .update({ research_output: output as any })
    .eq('id', draftRow.id)
  if (updateErr) throw new Error(`Failed to update draft: ${updateErr.message}`)

  // Bump stage if currently at 'research'. Don't regress later stages.
  await admin
    .from('diligence_deals')
    .update({ current_memo_stage: 'qa' })
    .eq('id', dealId)
    .eq('fund_id', fundId)
    .eq('current_memo_stage', 'research')

  return {
    draft_id: draftRow.id,
    research_output: output,
    warnings,
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
