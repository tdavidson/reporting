import yaml from 'js-yaml'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAIUsage } from '@/lib/ai/usage'
import { getStageProvider } from '@/lib/memo-agent/stage-provider'
import { getActiveSchema, ensureDefaults } from '@/lib/memo-agent/firm-schemas'
import { buildSystemPrompt } from '@/lib/memo-agent/prompts/system'
import { buildDraftUserContent, type QARecord } from '@/lib/memo-agent/prompts/draft'
import { extractJsonObject } from '@/lib/memo-agent/parse-ai-json'
import type { IngestionOutput } from './ingest'
import type { ResearchOutput } from './research'

type Admin = ReturnType<typeof createAdminClient>

export interface MemoParagraph {
  id: string
  section_id: string
  order: number
  prose: string
  sources: Array<{ source_type: string; source_id: string; span?: string | null }>
  origin: 'agent_drafted' | 'partner_drafted' | 'partner_only_placeholder' | 'partner_edited'
  confidence: 'low' | 'medium' | 'high' | 'n/a'
  contains_projection: boolean
  contains_unverified_claim: boolean
  contains_contradiction: boolean
}

export interface PartnerAttentionItem {
  kind: string
  urgency: 'must_address' | 'should_address' | 'fyi'
  body: string
  links: Array<{ source_type: string; source_id: string }>
}

export interface MemoDraftOutput {
  header: Record<string, any>
  paragraphs: MemoParagraph[]
  partner_attention: PartnerAttentionItem[]
}

export interface DraftResult {
  draft_id: string
  output: MemoDraftOutput
  warnings: string[]
}

/**
 * Stage 4 — assemble the memo draft from all upstream stage outputs.
 * Single AI call producing the entire memo_output JSON. Validation is
 * structural; per-paragraph source IDs are checked against the actual ID
 * sets from ingestion/research/qa.
 */
export async function runDraft(params: {
  admin: Admin
  fundId: string
  dealId: string
  draftId?: string
  progressCb?: (msg: string) => Promise<void>
}): Promise<DraftResult> {
  const { admin, fundId, dealId, progressCb } = params
  const note = async (msg: string) => { if (progressCb) await progressCb(msg) }
  const warnings: string[] = []

  await note('Loading draft inputs…')
  const draft = await loadDraftWithInputs(admin, fundId, dealId, params.draftId)
  if (!draft) throw new Error('No draft found. Run Stage 1 first.')
  if (!draft.ingestion_output) throw new Error('Ingestion output missing on draft. Run Stage 1 first.')

  const ingestion = draft.ingestion_output as IngestionOutput
  const research = (draft.research_output as ResearchOutput | null) ?? null
  const qa_answers = Array.isArray(draft.qa_answers) ? draft.qa_answers as QARecord[] : []

  // Input scale — surfaced in progress messages so the user can correlate
  // long-running calls with a known cause (large data room) vs. a hang.
  const docCount = ingestion.documents?.length ?? 0
  const claimCount = ingestion.documents?.reduce((acc, d) => acc + (d.claims?.length ?? 0), 0) ?? 0
  const findingCount = research?.findings?.length ?? 0
  const qaCount = qa_answers.length

  await note('Loading deal record…')
  const { data: dealRow } = await admin
    .from('diligence_deals')
    .select('name, sector, stage_at_consideration')
    .eq('id', dealId)
    .eq('fund_id', fundId)
    .maybeSingle()
  const deal = (dealRow as any) ?? { name: 'this deal' }

  await note('Loading schemas…')
  await ensureDefaults(fundId, admin)
  const memoOutputSchema = await getActiveSchema(fundId, 'memo_output', admin)
  const rubricSchema = await getActiveSchema(fundId, 'rubric', admin)
  if (!memoOutputSchema || !rubricSchema) {
    throw new Error('memo_output or rubric schema missing. Re-seed defaults.')
  }

  await note('Building draft prompt…')
  const { prompt: system } = await buildSystemPrompt({ admin, fundId, stage: 'draft' })

  const userContent = buildDraftUserContent({
    dealName: deal.name,
    memoOutputYaml: memoOutputSchema.yaml_content,
    rubricYaml: rubricSchema.yaml_content,
    ingestion,
    research,
    qa_answers,
  })

  await note(`Calling AI for draft (${docCount} docs, ${claimCount} claims, ${findingCount} findings, ${qaCount} Q&A)…`)
  const { provider, model, providerType } = await getStageProvider(admin, fundId, 'draft')
  const { text, usage, truncated } = await provider.createMessage({
    model,
    // Bumped from 16384. Memo drafts with many sections + multi-paragraph
    // team sections + partner_attention items routinely truncated at 16K,
    // which threw "non-JSON" via direct JSON.parse. 32K is the Opus ceiling
    // and well within Sonnet's range.
    maxTokens: 32768,
    system,
    content: userContent,
  })
  logAIUsage(admin, { fundId, provider: providerType, model, feature: 'memo_agent_draft', usage })

  if (truncated) {
    warnings.push('Draft output was truncated by the model (max_tokens reached). The memo may be missing later sections — consider re-running or splitting the draft.')
  }

  await note('Parsing draft…')
  const parsed = parseDraftResponse(text)

  // Force the recommendation section to a partner-only placeholder, even if
  // the model misbehaved.
  parsed.paragraphs = enforceRecommendationPlaceholder(parsed.paragraphs)

  // Quality checks — surface as warnings without failing the run so the
  // partner can still see + edit what came back.
  if (parsed.paragraphs.length === 0) {
    warnings.push('Draft produced 0 paragraphs. Model may have ignored the prompt — consider re-running.')
  }
  const sectionsCovered = new Set(parsed.paragraphs.map(p => p.section_id))
  if (sectionsCovered.size < 3) {
    warnings.push(`Draft covers only ${sectionsCovered.size} section(s). The model likely stopped early.`)
  }

  // Validate source IDs.
  const validIds = collectValidIds(ingestion, research, qa_answers)
  for (const p of parsed.paragraphs) {
    for (const s of p.sources) {
      if (s.source_type === 'partner_only') continue
      const set = validIds[s.source_type as keyof typeof validIds]
      if (set && !set.has(s.source_id)) {
        warnings.push(`Paragraph ${p.id} cites unknown ${s.source_type} id ${s.source_id}`)
      }
    }
  }

  await note('Writing draft to database…')
  const { error: updateErr } = await admin
    .from('diligence_memo_drafts')
    .update({ memo_draft_output: parsed as any })
    .eq('id', draft.id)
  if (updateErr) throw new Error(`Failed to persist draft: ${updateErr.message}`)

  await note('Writing partner attention items…')
  if (parsed.partner_attention.length > 0) {
    const rows = parsed.partner_attention.map(item => ({
      deal_id: dealId,
      draft_id: draft.id,
      fund_id: fundId,
      kind: item.kind,
      urgency: item.urgency,
      body: item.body,
      links: item.links as any,
      status: 'open',
    }))
    await admin.from('diligence_attention_items').insert(rows as any)
  }

  return { draft_id: draft.id, output: parsed, warnings }
}

// ---------------------------------------------------------------------------

interface DraftRow {
  id: string
  ingestion_output: unknown
  research_output: unknown
  qa_answers: unknown
}

async function loadDraftWithInputs(admin: Admin, fundId: string, dealId: string, draftId?: string): Promise<DraftRow | null> {
  if (draftId) {
    const { data } = await admin
      .from('diligence_memo_drafts')
      .select('id, ingestion_output, research_output, qa_answers')
      .eq('id', draftId)
      .eq('fund_id', fundId)
      .maybeSingle()
    return (data as any) ?? null
  }
  const { data } = await admin
    .from('diligence_memo_drafts')
    .select('id, ingestion_output, research_output, qa_answers')
    .eq('deal_id', dealId)
    .eq('fund_id', fundId)
    .eq('is_draft', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as any) ?? null
}

function parseDraftResponse(raw: string): MemoDraftOutput {
  const parsed = extractJsonObject(raw)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Draft AI returned non-object JSON')
  }
  const obj = parsed as Record<string, unknown>

  // Required structure check. Missing top-level keys mean the model didn't
  // follow the contract — fail loudly rather than silently persisting an
  // empty memo as a "successful" draft.
  const required = ['header', 'paragraphs', 'partner_attention'] as const
  const missing = required.filter(k => !(k in obj))
  if (missing.length > 0) {
    throw new Error(`Draft AI response missing required keys: ${missing.join(', ')}. First 300 chars: ${JSON.stringify(obj).slice(0, 300)}`)
  }

  return {
    header: (obj.header && typeof obj.header === 'object' ? obj.header : {}) as Record<string, any>,
    paragraphs: Array.isArray(obj.paragraphs) ? obj.paragraphs.map(coerceParagraph).filter(Boolean) as MemoParagraph[] : [],
    partner_attention: Array.isArray(obj.partner_attention) ? obj.partner_attention as any[] : [],
  }
}

function coerceParagraph(raw: unknown): MemoParagraph | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, any>
  if (typeof r.section_id !== 'string') return null
  return {
    id: typeof r.id === 'string' ? r.id : `p_${r.section_id}_${Math.random().toString(36).slice(2, 6)}`,
    section_id: r.section_id,
    order: typeof r.order === 'number' ? r.order : 0,
    prose: typeof r.prose === 'string' ? r.prose : '',
    sources: Array.isArray(r.sources) ? r.sources : [],
    origin: ['agent_drafted', 'partner_drafted', 'partner_only_placeholder', 'partner_edited'].includes(r.origin)
      ? r.origin as MemoParagraph['origin']
      : 'agent_drafted',
    confidence: ['low', 'medium', 'high', 'n/a'].includes(r.confidence) ? r.confidence : 'medium',
    contains_projection: !!r.contains_projection,
    contains_unverified_claim: !!r.contains_unverified_claim,
    contains_contradiction: !!r.contains_contradiction,
  }
}

function enforceRecommendationPlaceholder(paragraphs: MemoParagraph[]): MemoParagraph[] {
  const out = paragraphs.filter(p => p.section_id !== 'recommendation')
  out.push({
    id: 'p_recommendation_placeholder',
    section_id: 'recommendation',
    order: 0,
    prose: '[Partner to complete]',
    sources: [],
    origin: 'partner_only_placeholder',
    confidence: 'n/a',
    contains_projection: false,
    contains_unverified_claim: false,
    contains_contradiction: false,
  })
  return out
}

function collectValidIds(ingestion: IngestionOutput, research: ResearchOutput | null, qa: QARecord[]) {
  const claim = new Set<string>()
  for (const doc of ingestion.documents) for (const c of doc.claims) claim.add(c.id)
  const finding = new Set<string>()
  if (research) for (const f of research.findings) finding.add(f.id)
  const qa_answer = new Set<string>()
  for (const r of qa) qa_answer.add(r.question_id)
  return { claim, finding, qa_answer }
}
