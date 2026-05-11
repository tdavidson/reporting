import yaml from 'js-yaml'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAIUsage } from '@/lib/ai/usage'
import { getStageProvider } from '@/lib/memo-agent/stage-provider'
import { getActiveSchema, ensureDefaults } from '@/lib/memo-agent/firm-schemas'
import { buildSystemPrompt } from '@/lib/memo-agent/prompts/system'
import { buildScoreUserContent, type QARecord } from '@/lib/memo-agent/prompts/draft'
import type { IngestionOutput } from './ingest'
import type { ResearchOutput } from './research'
import type { MemoDraftOutput } from './draft'

type Admin = ReturnType<typeof createAdminClient>

export interface DimensionScore {
  dimension_id: string
  mode: 'machine' | 'hybrid' | 'partner_only'
  score: number | null
  confidence: 'low' | 'medium' | 'high' | null
  rationale: string
  supporting_evidence: Array<{ source_type: string; source_id: string }>
}

export interface ScoreOutput {
  scores: DimensionScore[]
  low_confidence_attention: Array<{ dimension_id: string; reason: string }>
}

export interface ScoreResult {
  draft_id: string
  output: ScoreOutput
}

/**
 * Stage 5 — score the draft per the active rubric.yaml. Partner-only
 * dimensions (e.g. team) are NEVER assigned a numeric score; the rationale
 * field carries supporting material for the partner to assign their own.
 */
export async function runScore(params: {
  admin: Admin
  fundId: string
  dealId: string
  draftId: string
  progressCb?: (msg: string) => Promise<void>
}): Promise<ScoreResult> {
  const { admin, fundId, dealId, draftId, progressCb } = params
  const note = async (msg: string) => { if (progressCb) await progressCb(msg) }

  await note('Loading draft + rubric…')
  const { data: draft } = await admin
    .from('diligence_memo_drafts')
    .select('id, ingestion_output, research_output, qa_answers, memo_draft_output')
    .eq('id', draftId)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!draft) throw new Error('Draft not found')
  if (!(draft as any).memo_draft_output) {
    throw new Error('memo_draft_output missing — Stage 4 (draft) must run first.')
  }

  const ingestion = (draft as any).ingestion_output as IngestionOutput
  const research = ((draft as any).research_output as ResearchOutput | null) ?? null
  const qa_answers = Array.isArray((draft as any).qa_answers) ? (draft as any).qa_answers as QARecord[] : []
  const memo = (draft as any).memo_draft_output as MemoDraftOutput

  // Seed-on-demand for funds that never visited the Schemas editor.
  await ensureDefaults(fundId, admin)
  const rubricSchema = await getActiveSchema(fundId, 'rubric', admin)
  if (!rubricSchema) throw new Error('rubric schema missing')
  const rubricParsed = (rubricSchema.parsed_content as any) ?? yaml.load(rubricSchema.yaml_content) as any
  const dimensions = (rubricParsed?.dimensions ?? []) as Array<{ id: string; mode: string }>

  const { data: dealRow } = await admin
    .from('diligence_deals')
    .select('name')
    .eq('id', dealId)
    .eq('fund_id', fundId)
    .maybeSingle()
  const dealName = (dealRow as { name: string } | null)?.name ?? 'this deal'

  await note('Building score prompt…')
  const { prompt: system } = await buildSystemPrompt({ admin, fundId, stage: 'score' })

  const memoSummary = summarizeMemoForScoring(memo)
  const userContent = buildScoreUserContent({
    dealName,
    rubricYaml: rubricSchema.yaml_content,
    ingestion,
    research,
    qa_answers,
    memo_draft_output_summary: memoSummary,
  })

  await note('Calling AI provider for scoring…')
  const { provider, model, providerType } = await getStageProvider(admin, fundId, 'score')
  const { text, usage } = await provider.createMessage({
    model,
    maxTokens: 4096,
    system,
    content: userContent,
  })
  logAIUsage(admin, { fundId, provider: providerType, model, feature: 'memo_agent_score', usage })

  const parsed = parseScoreResponse(text, dimensions)

  await note('Persisting scores to draft…')
  // Merge into memo_draft_output.scores (live alongside the prose).
  const merged: MemoDraftOutput & { scores: DimensionScore[]; low_confidence_attention?: ScoreOutput['low_confidence_attention'] } = {
    ...memo,
    scores: parsed.scores,
    low_confidence_attention: parsed.low_confidence_attention,
  }
  await admin
    .from('diligence_memo_drafts')
    .update({ memo_draft_output: merged as any })
    .eq('id', draftId)

  // Surface low-confidence dimensions as attention items for the partner.
  if (parsed.low_confidence_attention.length > 0) {
    const rows = parsed.low_confidence_attention.map(item => ({
      deal_id: dealId,
      draft_id: draftId,
      fund_id: fundId,
      kind: 'low_confidence_score',
      urgency: 'should_address',
      body: `${item.dimension_id}: ${item.reason}`,
      links: [{ source_type: 'rubric_dimension', source_id: item.dimension_id }] as any,
      status: 'open',
    }))
    await admin.from('diligence_attention_items').insert(rows as any)
  }

  return { draft_id: draftId, output: parsed }
}

// ---------------------------------------------------------------------------

function summarizeMemoForScoring(memo: MemoDraftOutput): string {
  const bySection = new Map<string, string[]>()
  for (const p of memo.paragraphs) {
    if (p.origin === 'partner_only_placeholder') continue
    if (!bySection.has(p.section_id)) bySection.set(p.section_id, [])
    bySection.get(p.section_id)!.push(p.prose)
  }
  const parts: string[] = []
  bySection.forEach((paragraphs, sec) => {
    parts.push(`## ${sec}`)
    parts.push(paragraphs.join('\n\n'))
  })
  return parts.join('\n\n')
}

function parseScoreResponse(raw: string, dimensions: Array<{ id: string; mode: string }>): ScoreOutput {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  let parsed: any
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Score AI returned non-JSON: ${cleaned.slice(0, 300)}`)
  }
  const validIds = new Set(dimensions.map(d => d.id))
  const dimensionMode = new Map(dimensions.map(d => [d.id, d.mode]))

  const scores: DimensionScore[] = (parsed?.scores ?? [])
    .filter((s: any) => typeof s?.dimension_id === 'string' && validIds.has(s.dimension_id))
    .map((s: any): DimensionScore => {
      const declaredMode = (dimensionMode.get(s.dimension_id) ?? 'machine') as 'machine' | 'hybrid' | 'partner_only'
      // Force team / partner-only dimensions to score=null even if the model misbehaved.
      const partnerOnly = declaredMode === 'partner_only'
      const score = partnerOnly ? null : (typeof s.score === 'number' && s.score >= 1 && s.score <= 5 ? s.score : null)
      const confidence = partnerOnly ? null : (['low', 'medium', 'high'].includes(s.confidence) ? s.confidence : null)
      return {
        dimension_id: s.dimension_id,
        mode: declaredMode,
        score,
        confidence,
        rationale: typeof s.rationale === 'string' ? s.rationale : '',
        supporting_evidence: Array.isArray(s.supporting_evidence) ? s.supporting_evidence : [],
      }
    })

  // Ensure every rubric dimension is represented, even if the model missed one.
  for (const d of dimensions) {
    if (!scores.find(s => s.dimension_id === d.id)) {
      scores.push({
        dimension_id: d.id,
        mode: d.mode as DimensionScore['mode'],
        score: null,
        confidence: null,
        rationale: 'No score produced for this dimension.',
        supporting_evidence: [],
      })
    }
  }

  return {
    scores,
    low_confidence_attention: Array.isArray(parsed?.low_confidence_attention) ? parsed.low_confidence_attention : [],
  }
}
