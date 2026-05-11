import yaml from 'js-yaml'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAIUsage } from '@/lib/ai/usage'
import { getStageProvider } from '@/lib/memo-agent/stage-provider'
import { getActiveSchema, ensureDefaults } from '@/lib/memo-agent/firm-schemas'
import { buildSystemPrompt } from '@/lib/memo-agent/prompts/system'
import { buildQAUserContent, type QAQuestion, type PriorAnswer } from '@/lib/memo-agent/prompts/qa'
import type { IngestionOutput } from './ingest'
import type { ResearchOutput } from './research'

type Admin = ReturnType<typeof createAdminClient>

export interface QABatchItem {
  question_id: string
  prompt: string
  rationale: string
  category: string
  intent: string
  sensitivity: 'standard' | 'high'
}

export interface QACoveredItem {
  question_id: string
  covered_by: 'ingestion' | 'research' | 'prior_answer'
  evidence: string
}

export interface QASessionState {
  session_id: string
  draft_id: string
  asked_ids: string[]
  /** Map of question_id → answer (latest only). */
  answers: Record<string, { answer_text: string; partner_id: string | null; answered_at: string }>
  /** Open question IDs in current batch (sent but not yet answered). */
  pending_question_ids: string[]
  total_questions: number
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

interface SessionMessage {
  role: 'system' | 'agent_batch' | 'partner_answer' | 'agent_covered'
  ts: string
  data: any
}

interface SessionRow {
  id: string
  fund_id: string
  deal_id: string
  stage: string | null
  messages: SessionMessage[]
}

async function loadSession(admin: Admin, sessionId: string, fundId: string): Promise<SessionRow | null> {
  const { data } = await admin
    .from('diligence_agent_sessions')
    .select('id, fund_id, deal_id, stage, messages')
    .eq('id', sessionId)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!data) return null
  const row = data as any
  return {
    ...row,
    messages: Array.isArray(row.messages) ? row.messages : [],
  }
}

async function saveMessages(admin: Admin, sessionId: string, fundId: string, messages: SessionMessage[]) {
  await admin
    .from('diligence_agent_sessions')
    .update({ messages: messages as any })
    .eq('id', sessionId)
    .eq('fund_id', fundId)
}

function extractAskedIds(messages: SessionMessage[]): Set<string> {
  const ids = new Set<string>()
  for (const m of messages) {
    if (m.role === 'agent_batch' && Array.isArray(m.data?.batch)) {
      for (const item of m.data.batch) if (typeof item.question_id === 'string') ids.add(item.question_id)
    }
    if (m.role === 'agent_covered' && Array.isArray(m.data?.covered)) {
      // Don't re-ask a covered question.
      for (const item of m.data.covered) if (typeof item.question_id === 'string') ids.add(item.question_id)
    }
  }
  return ids
}

function extractAnswers(messages: SessionMessage[]): Record<string, { answer_text: string; partner_id: string | null; answered_at: string }> {
  const out: Record<string, any> = {}
  for (const m of messages) {
    if (m.role === 'partner_answer' && Array.isArray(m.data?.answers)) {
      for (const a of m.data.answers) {
        if (typeof a.question_id === 'string' && typeof a.answer_text === 'string') {
          out[a.question_id] = {
            answer_text: a.answer_text,
            partner_id: a.partner_id ?? null,
            answered_at: m.ts,
          }
        }
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Public API: state introspection
// ---------------------------------------------------------------------------

export async function loadSessionState(admin: Admin, sessionId: string, fundId: string, draftId: string): Promise<QASessionState | null> {
  const session = await loadSession(admin, sessionId, fundId)
  if (!session) return null
  const askedIds = extractAskedIds(session.messages)
  const answers = extractAnswers(session.messages)
  const lastBatch = [...session.messages].reverse().find(m => m.role === 'agent_batch')
  const pending: string[] = lastBatch?.data?.batch?.map((b: any) => b.question_id) ?? []
  const stillPending = pending.filter(id => !answers[id])
  // total questions known from active library
  const lib = await loadQuestionLibrary(admin, fundId)
  return {
    session_id: sessionId,
    draft_id: draftId,
    asked_ids: Array.from(askedIds),
    answers,
    pending_question_ids: stillPending,
    total_questions: lib.questions.length,
  }
}

// ---------------------------------------------------------------------------
// Q&A Library
// ---------------------------------------------------------------------------

interface ParsedQALibrary {
  questions: QAQuestion[]
  questions_by_category: Map<string, QAQuestion[]>
  category_order: string[]
  batch_min: number
  batch_max: number
}

async function loadQuestionLibrary(admin: Admin, fundId: string): Promise<ParsedQALibrary> {
  // Seed-on-demand: if a fund has never visited the Schemas editor, the
  // default rows haven't been written yet. Insert them transparently before
  // reading so the first Q&A run on a new fund just works.
  await ensureDefaults(fundId, admin)
  const schema = await getActiveSchema(fundId, 'qa_library', admin)
  if (!schema?.yaml_content) {
    throw new Error('qa_library schema missing for fund. Visit Settings → Memo Agent → Schemas to seed defaults.')
  }
  const parsed = (schema.parsed_content as any) ?? yaml.load(schema.yaml_content) as any
  const questions = (parsed?.questions ?? []) as QAQuestion[]
  const cats = (parsed?.categories ?? []) as Array<{ id: string; order: number }>
  const sortedCats = cats.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(c => c.id)
  const byCat = new Map<string, QAQuestion[]>()
  for (const c of sortedCats) byCat.set(c, [])
  for (const q of questions) {
    if (!byCat.has(q.category)) byCat.set(q.category, [])
    byCat.get(q.category)!.push(q)
  }
  const batching = parsed?.batching_rules?.questions_per_batch ?? {}
  return {
    questions,
    questions_by_category: byCat,
    category_order: sortedCats.length ? sortedCats : Array.from(byCat.keys()),
    batch_min: typeof batching.min === 'number' ? batching.min : 4,
    batch_max: typeof batching.max === 'number' ? batching.max : 6,
  }
}

// ---------------------------------------------------------------------------
// Public API: get next batch
// ---------------------------------------------------------------------------

export async function getNextBatch(params: {
  admin: Admin
  fundId: string
  dealId: string
  draftId: string
  sessionId: string
}): Promise<{ batch: QABatchItem[]; covered: QACoveredItem[]; total_remaining: number }> {
  const { admin, fundId, dealId, draftId, sessionId } = params

  const lib = await loadQuestionLibrary(admin, fundId)

  // Existing session state.
  const session = await loadSession(admin, sessionId, fundId)
  if (!session) throw new Error('Session not found')
  const askedIds = extractAskedIds(session.messages)
  const answers = extractAnswers(session.messages)

  // Build candidate pool: not asked, not answered, in category order.
  const candidatesOrdered: QAQuestion[] = []
  for (const cat of lib.category_order) {
    for (const q of lib.questions_by_category.get(cat) ?? []) {
      if (askedIds.has(q.id)) continue
      if (answers[q.id]) continue
      candidatesOrdered.push(q)
    }
  }

  if (candidatesOrdered.length === 0) {
    return { batch: [], covered: [], total_remaining: 0 }
  }

  // Limit candidates the AI sees to a reasonable window so the prompt stays
  // small. The agent can only pick from this pool.
  const candidatePool = candidatesOrdered.slice(0, Math.max(lib.batch_max * 4, 20))

  // Load draft outputs for skip logic.
  const { data: draftRow } = await admin
    .from('diligence_memo_drafts')
    .select('ingestion_output, research_output')
    .eq('id', draftId)
    .eq('fund_id', fundId)
    .maybeSingle()
  const ingestion = (draftRow as any)?.ingestion_output as IngestionOutput | null ?? null
  const research = (draftRow as any)?.research_output as ResearchOutput | null ?? null

  const priorAnswers: PriorAnswer[] = Object.entries(answers).map(([qid, a]) => ({
    question_id: qid,
    answer_text: a.answer_text,
    partner_id: a.partner_id,
    answered_at: a.answered_at,
  }))

  const { data: dealRow } = await admin
    .from('diligence_deals')
    .select('name')
    .eq('id', dealId)
    .eq('fund_id', fundId)
    .maybeSingle()
  const dealName = (dealRow as { name: string } | null)?.name ?? 'this deal'

  const { prompt: system } = await buildSystemPrompt({ admin, fundId, stage: 'qa' })
  const userContent = buildQAUserContent({
    dealName,
    ingestion,
    research,
    candidates: candidatePool,
    prior_answers: priorAnswers,
    batch_min: lib.batch_min,
    batch_max: lib.batch_max,
  })

  const { provider, model, providerType } = await getStageProvider(admin, fundId, 'qa')
  const { text, usage } = await provider.createMessage({
    model,
    maxTokens: 2048,
    system,
    content: userContent,
  })
  logAIUsage(admin, { fundId, provider: providerType, model, feature: 'memo_agent_qa_batch', usage })

  const parsed = parseQAResponse(text, candidatePool)

  // Persist this exchange.
  const newMessages: SessionMessage[] = [...session.messages]
  if (parsed.batch.length > 0) newMessages.push({ role: 'agent_batch', ts: new Date().toISOString(), data: { batch: parsed.batch } })
  if (parsed.covered.length > 0) newMessages.push({ role: 'agent_covered', ts: new Date().toISOString(), data: { covered: parsed.covered } })
  await saveMessages(admin, sessionId, fundId, newMessages)

  const remainingAfter = candidatesOrdered.length - parsed.batch.length - parsed.covered.length
  return { ...parsed, total_remaining: Math.max(0, remainingAfter) }
}

function parseQAResponse(raw: string, candidates: QAQuestion[]): { batch: QABatchItem[]; covered: QACoveredItem[] } {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  let parsed: any
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    return { batch: [], covered: [] }
  }
  const candidateMap = new Map(candidates.map(q => [q.id, q]))

  const batch: QABatchItem[] = []
  for (const item of (parsed?.batch ?? [])) {
    const q = candidateMap.get(item?.question_id)
    if (!q) continue
    batch.push({
      question_id: q.id,
      prompt: typeof item.prompt === 'string' ? item.prompt : q.prompt,
      rationale: typeof item.rationale === 'string' ? item.rationale : '',
      category: q.category,
      intent: q.intent,
      sensitivity: q.sensitivity,
    })
  }

  const covered: QACoveredItem[] = []
  for (const item of (parsed?.covered ?? [])) {
    const id = typeof item?.question_id === 'string' ? item.question_id : null
    if (!id || !candidateMap.has(id)) continue
    if (batch.some(b => b.question_id === id)) continue
    covered.push({
      question_id: id,
      covered_by: ['ingestion', 'research', 'prior_answer'].includes(item?.covered_by) ? item.covered_by : 'ingestion',
      evidence: typeof item?.evidence === 'string' ? item.evidence : '',
    })
  }

  return { batch, covered }
}

// ---------------------------------------------------------------------------
// Public API: record partner answers
// ---------------------------------------------------------------------------

export async function recordResponses(params: {
  admin: Admin
  fundId: string
  sessionId: string
  partnerId: string
  answers: Array<{ question_id: string; answer_text: string }>
}): Promise<{ recorded: number }> {
  const { admin, fundId, sessionId, partnerId, answers } = params
  const session = await loadSession(admin, sessionId, fundId)
  if (!session) throw new Error('Session not found')

  const newMsg: SessionMessage = {
    role: 'partner_answer',
    ts: new Date().toISOString(),
    data: { answers: answers.map(a => ({ ...a, partner_id: partnerId })) },
  }
  const updated = [...session.messages, newMsg]
  await saveMessages(admin, sessionId, fundId, updated)
  return { recorded: answers.length }
}

// ---------------------------------------------------------------------------
// Public API: finish — write consolidated answers to the draft
// ---------------------------------------------------------------------------

export async function finishQA(params: {
  admin: Admin
  fundId: string
  dealId: string
  sessionId: string
  draftId: string
}): Promise<{ qa_count: number }> {
  const { admin, fundId, dealId, sessionId, draftId } = params
  const session = await loadSession(admin, sessionId, fundId)
  if (!session) throw new Error('Session not found')

  const answers = extractAnswers(session.messages)
  // Look up question metadata so we can preserve feeds_dimensions on the draft.
  const lib = await loadQuestionLibrary(admin, fundId)
  const byId = new Map(lib.questions.map(q => [q.id, q]))

  const records = Object.entries(answers).map(([qid, a]) => ({
    question_id: qid,
    answer_text: a.answer_text,
    partner_id: a.partner_id,
    answered_at: a.answered_at,
    feeds_dimensions: byId.get(qid)?.feeds_dimensions ?? [],
    category: byId.get(qid)?.category ?? null,
  }))

  await admin
    .from('diligence_memo_drafts')
    .update({ qa_answers: records as any })
    .eq('id', draftId)
    .eq('fund_id', fundId)

  await admin
    .from('diligence_deals')
    .update({ current_memo_stage: 'draft' })
    .eq('id', dealId)
    .eq('fund_id', fundId)
    .eq('current_memo_stage', 'qa')

  return { qa_count: records.length }
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export async function startQASession(params: {
  admin: Admin
  fundId: string
  dealId: string
  draftId: string
  userId: string
}): Promise<string> {
  const { admin, fundId, dealId, draftId, userId } = params

  // Reuse most recent open Q&A session if one exists for this draft.
  const { data: existing } = await admin
    .from('diligence_agent_sessions')
    .select('id, messages')
    .eq('deal_id', dealId)
    .eq('fund_id', fundId)
    .eq('stage', 'qa')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing) return (existing as any).id

  const { data: created, error } = await admin
    .from('diligence_agent_sessions')
    .insert({
      deal_id: dealId,
      fund_id: fundId,
      stage: 'qa',
      title: `Stage 3 Q&A`,
      messages: [],
      created_by: userId,
    } as any)
    .select('id')
    .single()
  if (error || !created) throw new Error(`Failed to create Q&A session: ${error?.message ?? 'unknown'}`)

  // Mark deal stage.
  await admin
    .from('diligence_deals')
    .update({ current_memo_stage: 'qa' })
    .eq('id', dealId)
    .eq('fund_id', fundId)

  return (created as any).id
}
