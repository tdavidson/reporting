import yaml from 'js-yaml'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAIUsage } from '@/lib/ai/usage'
import { getStageProvider } from '@/lib/memo-agent/stage-provider'
import { getActiveSchema, ensureDefaults } from '@/lib/memo-agent/firm-schemas'
import { buildSystemPrompt } from '@/lib/memo-agent/prompts/system'
import { buildScoreUserContent, type QARecord } from '@/lib/memo-agent/prompts/draft'
import { runBatchedExtraction } from '@/lib/memo-agent/batched-extraction'
import type { IngestionOutput } from './ingest'
import type { ResearchOutput } from './research'
import type { MemoDraftOutput } from './draft'

type Admin = ReturnType<typeof createAdminClient>

// Rubric dimensions scored per LLM call. Batching keeps each response's JSON
// well under the model's output-token cap so long/custom rubrics stop
// truncating mid-array. The full rubric is resent for context each call.
const SCORE_DIMENSIONS_PER_CALL = 6

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
  warnings: string[]
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
  // Partner-excluded Q&A entries are dropped from evaluation entirely.
  const qa_answers = (Array.isArray((draft as any).qa_answers) ? (draft as any).qa_answers as QARecord[] : []).filter((r: QARecord) => !r.excluded)
  const memo = (draft as any).memo_draft_output as MemoDraftOutput

  // Seed-on-demand for funds that never visited the Schemas editor.
  await ensureDefaults(fundId, admin)
  const rubricSchema = await getActiveSchema(fundId, 'rubric', admin)
  if (!rubricSchema) throw new Error('rubric schema missing')
  const rubricParsed = (rubricSchema.parsed_content as any) ?? yaml.load(rubricSchema.yaml_content) as any
  const dimensions = (rubricParsed?.dimensions ?? []) as Array<{ id: string; mode: string }>

  const { data: dealRow } = await admin
    .from('diligence_deals')
    .select('name, stage_at_consideration')
    .eq('id', dealId)
    .eq('fund_id', fundId)
    .maybeSingle()
  const dealName = (dealRow as { name: string } | null)?.name ?? 'this deal'
  const dealStage = (dealRow as { stage_at_consideration: string | null } | null)?.stage_at_consideration ?? null

  await note('Building score prompt…')
  const { prompt: system } = await buildSystemPrompt({ admin, fundId, stage: 'score' })

  const memoSummary = summarizeMemoForScoring(memo)

  await note('Scoring rubric dimensions…')
  const { provider, model, providerType } = await getStageProvider(admin, fundId, 'score')
  const dimensionMode = new Map(dimensions.map(d => [d.id, d.mode]))
  const validIds = new Set(dimensions.map(d => d.id))

  // Score in batches of dimensions so no single call's JSON output runs past
  // the model's output-token budget (the old single call truncated on fuller
  // rubrics). Each batch resends the shared context but emits only its own
  // dimensions; per-batch failures degrade to warnings instead of failing.
  const { rows, warnings, batchErrors } = await runBatchedExtraction<{ id: string; mode: string }, DimensionScore>({
    units: dimensions,
    batchSize: SCORE_DIMENSIONS_PER_CALL,
    arrayKey: 'scores',
    label: (batch) => batch.map(d => d.id).join(', '),
    note,
    call: async (batch) => {
      const res = await provider.createMessage({
        model,
        maxTokens: 8192,
        system,
        content: buildScoreUserContent({
          dealName,
          stage: dealStage,
          rubricYaml: rubricSchema.yaml_content,
          ingestion,
          research,
          qa_answers,
          memo_draft_output_summary: memoSummary,
          onlyDimensionIds: batch.map(d => d.id),
        }),
      })
      logAIUsage(admin, { fundId, dealId, provider: providerType, model, feature: 'memo_agent_score', usage: res.usage })
      return res
    },
    coerce: (raw) => coerceScoreRow(raw, dimensionMode, validIds),
  })

  // If every batch failed, surface the reasons rather than persisting nothing.
  if (rows.length === 0 && batchErrors.length > 0) {
    throw new Error(`Scoring produced no usable dimensions (${batchErrors.join('; ')}).`)
  }
  if (batchErrors.length > 0) {
    warnings.push(`${batchErrors.length} scoring batch(es) failed: ${batchErrors.join('; ')}.`)
  }

  // Dedupe by dimension_id (last wins), then ensure every rubric dimension is
  // represented, preserving rubric order.
  const byId = new Map<string, DimensionScore>()
  for (const r of rows) byId.set(r.dimension_id, r)
  for (const d of dimensions) {
    if (!byId.has(d.id)) {
      byId.set(d.id, {
        dimension_id: d.id,
        mode: d.mode as DimensionScore['mode'],
        score: null,
        confidence: null,
        rationale: 'No score produced for this dimension.',
        supporting_evidence: [],
      })
    }
  }
  const scores = dimensions.map(d => byId.get(d.id)!)

  // Derive low-confidence attention from the merged scores: machine/hybrid
  // dimensions left unscored or scored with low confidence.
  const low_confidence_attention = scores
    .filter(s => s.mode !== 'partner_only' && (s.score === null || s.confidence === 'low'))
    .map(s => ({
      dimension_id: s.dimension_id,
      reason: s.score === null
        ? 'No confident score could be assigned from the available evidence.'
        : 'Scored with low confidence — partner review recommended.',
    }))

  const output: ScoreOutput = { scores, low_confidence_attention }

  await note('Persisting scores to draft…')
  // Merge into memo_draft_output.scores (live alongside the prose).
  const merged: MemoDraftOutput & { scores: DimensionScore[]; low_confidence_attention?: ScoreOutput['low_confidence_attention'] } = {
    ...memo,
    scores,
    low_confidence_attention,
  }
  await admin
    .from('diligence_memo_drafts')
    .update({ memo_draft_output: merged as any })
    .eq('id', draftId)

  // Surface low-confidence dimensions as attention items for the partner.
  if (low_confidence_attention.length > 0) {
    const attnRows = low_confidence_attention.map(item => ({
      deal_id: dealId,
      draft_id: draftId,
      fund_id: fundId,
      kind: 'low_confidence_score',
      urgency: 'should_address',
      body: `${item.dimension_id}: ${item.reason}`,
      links: [{ source_type: 'rubric_dimension', source_id: item.dimension_id }] as any,
      status: 'open',
    }))
    await admin.from('diligence_attention_items').insert(attnRows as any)
  }

  return { draft_id: draftId, output, warnings }
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

// Normalize one raw score object from the model into a DimensionScore, or null
// if it isn't a recognized rubric dimension. Partner-only dimensions are forced
// to score=null even if the model misbehaved.
function coerceScoreRow(
  raw: unknown,
  dimensionMode: Map<string, string>,
  validIds: Set<string>,
): DimensionScore | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as any
  if (typeof s.dimension_id !== 'string' || !validIds.has(s.dimension_id)) return null
  const declaredMode = (dimensionMode.get(s.dimension_id) ?? 'machine') as DimensionScore['mode']
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
}
