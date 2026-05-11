import { createAdminClient } from '@/lib/supabase/admin'
import { logAIUsage } from '@/lib/ai/usage'
import { buildSystemPrompt } from '@/lib/memo-agent/prompts/system'
import { buildIngestUserContent } from '@/lib/memo-agent/prompts/ingest'
import { getStageProvider } from '@/lib/memo-agent/stage-provider'
import { loadDealDocuments } from '@/lib/memo-agent/ingestion/sources'
import { parseAll, type ParsedFile } from '@/lib/memo-agent/ingestion/parsers'

type Admin = ReturnType<typeof createAdminClient>

export interface IngestionDocumentOutput {
  document_id: string
  detected_type: string
  type_confidence: 'low' | 'medium' | 'high'
  summary: string
  claims: Array<{
    id: string
    field: string
    value: string
    context: string
    verification_status: 'unverified'
    criticality: 'high' | 'medium' | 'low'
  }>
  issues?: string[]
}

export interface IngestionGap {
  expected_type?: string
  document_id?: string
  criticality: 'blocker' | 'important' | 'nice_to_have'
  rationale: string
}

export interface IngestionOutput {
  documents: IngestionDocumentOutput[]
  gap_analysis: {
    missing: IngestionGap[]
    inadequate: IngestionGap[]
  }
  cross_doc_flags: Array<{ description: string; doc_ids: string[] }>
}

export interface IngestionResult {
  draft_id: string
  ingestion_output: IngestionOutput
  documents_processed: number
  /** Flagged but non-fatal issues from parsing/validation. */
  warnings: string[]
}

/**
 * Run Stage 1 — data-room ingestion. Loads documents, parses them, calls the
 * fund's default AI provider with the system + ingest prompts, validates the
 * JSON response, and writes the result to a `diligence_memo_drafts` row.
 *
 * On success: also updates each document's detected_type/confidence per the
 * agent's classification (overriding the heuristic from upload), and bumps
 * `diligence_deals.current_memo_stage` to 'research'.
 */
export async function runIngest(params: {
  admin: Admin
  fundId: string
  dealId: string
  documentIds?: string[]
  draftId?: string
  progressCb?: (msg: string) => Promise<void>
}): Promise<IngestionResult> {
  const { admin, fundId, dealId, documentIds, progressCb } = params

  const note = async (msg: string) => { if (progressCb) await progressCb(msg) }

  await note('Loading documents…')
  const sources = await loadDealDocuments(admin, dealId, fundId, documentIds)
  if (sources.length === 0) {
    throw new Error('No documents to ingest. Upload files to the deal room first.')
  }

  await note(`Parsing ${sources.length} document${sources.length === 1 ? '' : 's'}…`)
  const parsed = await parseAll(sources)

  await note('Building system prompt…')
  const { prompt: system } = await buildSystemPrompt({ admin, fundId, stage: 'ingest' })

  await note('Loading deal record…')
  const { data: dealRow } = await admin
    .from('diligence_deals')
    .select('name')
    .eq('id', dealId)
    .eq('fund_id', fundId)
    .maybeSingle()
  const dealName = (dealRow as { name: string } | null)?.name ?? 'this deal'

  await note('Calling AI provider for ingestion…')
  const { provider, model, providerType } = await getStageProvider(admin, fundId, 'ingest')
  const userContent = buildIngestUserContent({ dealName, files: parsed })

  let raw: string
  try {
    const { text, usage } = await provider.createMessage({
      model,
      maxTokens: 16384,
      system,
      content: userContent,
    })
    raw = text
    logAIUsage(admin, {
      fundId,
      provider: providerType,
      model,
      feature: 'memo_agent_ingest',
      usage,
    })
  } catch (err) {
    throw new Error(`Ingest AI call failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  await note('Parsing ingestion output…')
  const output = parseIngestionResponse(raw)
  const warnings: string[] = []

  // Validate document_id references against the input set.
  const validDocIds = new Set(sources.map(s => s.document_id))
  for (const doc of output.documents) {
    if (!validDocIds.has(doc.document_id)) {
      warnings.push(`AI returned document_id "${doc.document_id}" not in input set; ignoring.`)
    }
  }
  output.documents = output.documents.filter(d => validDocIds.has(d.document_id))

  // Persist to drafts.
  await note('Writing ingestion output to draft…')
  const draftId = await persistDraft(admin, fundId, dealId, output, params.draftId)

  // Update document classifications based on agent's output.
  await note('Updating document classifications…')
  for (const doc of output.documents) {
    await admin
      .from('diligence_documents')
      .update({
        detected_type: doc.detected_type,
        type_confidence: doc.type_confidence,
        parse_status: 'parsed',
      })
      .eq('id', doc.document_id)
      .eq('deal_id', dealId)
      .eq('fund_id', fundId)
  }

  // Mark un-summarized files as failed (e.g. PPTX with no slides).
  for (const file of parsed) {
    if (file.errors.length > 0 && !output.documents.find(d => d.document_id === file.document_id)) {
      await admin
        .from('diligence_documents')
        .update({ parse_status: 'failed', parse_notes: file.errors.join('; ') })
        .eq('id', file.document_id)
        .eq('deal_id', dealId)
        .eq('fund_id', fundId)
    }
  }

  // Bump deal stage.
  await admin
    .from('diligence_deals')
    .update({ current_memo_stage: 'research' })
    .eq('id', dealId)
    .eq('fund_id', fundId)

  return {
    draft_id: draftId,
    ingestion_output: output,
    documents_processed: output.documents.length,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Persist
// ---------------------------------------------------------------------------

async function persistDraft(
  admin: Admin,
  fundId: string,
  dealId: string,
  output: IngestionOutput,
  draftId?: string,
): Promise<string> {
  if (draftId) {
    const { error } = await admin
      .from('diligence_memo_drafts')
      .update({ ingestion_output: output as any })
      .eq('id', draftId)
      .eq('deal_id', dealId)
      .eq('fund_id', fundId)
    if (error) throw new Error(`Failed to update draft: ${error.message}`)
    return draftId
  }

  // Find the most recent in-progress draft to update; create if none.
  const { data: existing } = await admin
    .from('diligence_memo_drafts')
    .select('id')
    .eq('deal_id', dealId)
    .eq('fund_id', fundId)
    .eq('is_draft', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    const id = (existing as { id: string }).id
    const { error } = await admin
      .from('diligence_memo_drafts')
      .update({ ingestion_output: output as any })
      .eq('id', id)
    if (error) throw new Error(`Failed to update draft: ${error.message}`)
    return id
  }

  const version = `v0.1-ingest-${new Date().toISOString().slice(0, 10)}`
  const { data: created, error: insertErr } = await admin
    .from('diligence_memo_drafts')
    .insert({
      deal_id: dealId,
      fund_id: fundId,
      draft_version: version,
      agent_version: 'memo-agent v0.1',
      ingestion_output: output as any,
    } as any)
    .select('id')
    .single()
  if (insertErr || !created) throw new Error(`Failed to create draft: ${insertErr?.message ?? 'unknown'}`)
  return (created as { id: string }).id
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseIngestionResponse(raw: string): IngestionOutput {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch (err) {
    throw new Error(`Ingest AI returned non-JSON: ${cleaned.slice(0, 300)}`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Ingest AI returned non-object JSON')
  }
  const obj = parsed as Record<string, unknown>
  const documents = Array.isArray(obj.documents) ? obj.documents : []
  const gap = (obj.gap_analysis as any) ?? {}

  return {
    documents: documents.map(coerceDocument).filter(Boolean) as IngestionDocumentOutput[],
    gap_analysis: {
      missing: Array.isArray(gap.missing) ? gap.missing.map(coerceGap).filter(Boolean) as IngestionGap[] : [],
      inadequate: Array.isArray(gap.inadequate) ? gap.inadequate.map(coerceGap).filter(Boolean) as IngestionGap[] : [],
    },
    cross_doc_flags: Array.isArray(obj.cross_doc_flags) ? obj.cross_doc_flags as any[] : [],
  }
}

function coerceDocument(raw: unknown): IngestionDocumentOutput | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.document_id !== 'string' || typeof r.detected_type !== 'string') return null
  const conf = ['low', 'medium', 'high'].includes(r.type_confidence as string) ? r.type_confidence as 'low' | 'medium' | 'high' : 'low'
  return {
    document_id: r.document_id,
    detected_type: r.detected_type,
    type_confidence: conf,
    summary: typeof r.summary === 'string' ? r.summary : '',
    claims: Array.isArray(r.claims) ? r.claims.map(coerceClaim).filter(Boolean) as IngestionDocumentOutput['claims'] : [],
    issues: Array.isArray(r.issues) ? r.issues.filter(s => typeof s === 'string') as string[] : undefined,
  }
}

function coerceClaim(raw: unknown): IngestionDocumentOutput['claims'][number] | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.field !== 'string' || typeof r.value !== 'string') return null
  const crit = ['high', 'medium', 'low'].includes(r.criticality as string) ? r.criticality as 'high' | 'medium' | 'low' : 'medium'
  return {
    id: typeof r.id === 'string' ? r.id : `claim_${Math.random().toString(36).slice(2, 8)}`,
    field: r.field,
    value: r.value,
    context: typeof r.context === 'string' ? r.context : '',
    verification_status: 'unverified',
    criticality: crit,
  }
}

function coerceGap(raw: unknown): IngestionGap | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const crit = ['blocker', 'important', 'nice_to_have'].includes(r.criticality as string)
    ? r.criticality as IngestionGap['criticality']
    : 'important'
  if (typeof r.rationale !== 'string') return null
  return {
    expected_type: typeof r.expected_type === 'string' ? r.expected_type : undefined,
    document_id: typeof r.document_id === 'string' ? r.document_id : undefined,
    criticality: crit,
    rationale: r.rationale,
  }
}
