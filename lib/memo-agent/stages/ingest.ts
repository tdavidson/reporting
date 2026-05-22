import { createAdminClient } from '@/lib/supabase/admin'
import { logAIUsage } from '@/lib/ai/usage'
import { buildSystemPrompt } from '@/lib/memo-agent/prompts/system'
import { buildIngestDocContent, buildIngestSynthesisContent } from '@/lib/memo-agent/prompts/ingest'
import { getStageProvider } from '@/lib/memo-agent/stage-provider'
import { loadDealDocuments } from '@/lib/memo-agent/ingestion/sources'
import { parseAll, type ParsedFile } from '@/lib/memo-agent/ingestion/parsers'
import { extractJsonObject } from '@/lib/memo-agent/parse-ai-json'

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
  /** Partner-dismissed gaps are kept for the record but ignored downstream. */
  dismissed?: boolean
}

export interface IngestionOutput {
  documents: IngestionDocumentOutput[]
  gap_analysis: {
    missing: IngestionGap[]
    inadequate: IngestionGap[]
  }
  cross_doc_flags: Array<{ description: string; doc_ids: string[] }>
}

export interface IngestionDocsResult {
  draft_id: string
  ingestion_documents: IngestionDocumentOutput[]
  documents_processed: number
  warnings: string[]
}

export interface IngestionSynthesisResult {
  draft_id: string
  gap_analysis: IngestionOutput['gap_analysis']
  cross_doc_flags: IngestionOutput['cross_doc_flags']
  warnings: string[]
}

/**
 * Stage 1A — per-document data-room ingestion.
 *
 * Fans out one AI call per parsed document in parallel, persists the per-doc
 * results to the draft, classifies each document, and bumps the deal's
 * `current_memo_stage` to 'research'. Cross-document synthesis (gap analysis
 * + cross-doc flags) is intentionally NOT done here — see runIngestSynthesis.
 *
 * The split exists because a combined run blew past the 300s Vercel ceiling
 * on multi-doc data rooms. Each phase now gets its own 300s budget, and
 * per-doc results survive even if synthesis later fails.
 */
export async function runIngestDocs(params: {
  admin: Admin
  fundId: string
  dealId: string
  documentIds?: string[]
  draftId?: string
  progressCb?: (msg: string) => Promise<void>
}): Promise<IngestionDocsResult> {
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

  const { provider, model, providerType } = await getStageProvider(admin, fundId, 'ingest')

  const manifest = parsed.map(f => ({
    file_name: f.file_name,
    file_format: f.file_format,
    detected_type: f.detected_type,
  }))

  await note(`Extracting claims from ${parsed.length} document${parsed.length === 1 ? '' : 's'} (5 at a time)…`)
  const warnings: string[] = []
  let completed = 0

  // Cap concurrent AI calls. Firing all 17+ in true parallel can trip
  // Anthropic's per-minute input-token limit, causing some calls to fail
  // even when the docs themselves are fine. Chunking to 5 keeps us under
  // typical tier 1 caps while still finishing the fan-out comfortably
  // inside the 300s function budget.
  const CONCURRENCY = 5
  const processFile = async (file: ParsedFile): Promise<IngestionDocumentOutput | null> => {
    if (file.errors.length > 0 && !file.text && !file.base64) {
      const reason = file.errors.join('; ')
      warnings.push(`Skipping ${file.file_name}: ${reason}`)
      // Don't double-push to file.errors — already populated by the parser.
      return null
    }

    try {
      const { text, usage } = await provider.createMessage({
        model,
        // Bumped from 8192 — large docs with many claims were truncating
        // mid-JSON, which then failed JSON.parse and dropped the whole doc.
        maxTokens: 12288,
        system,
        content: buildIngestDocContent({ dealName, file, manifest }),
      })
      logAIUsage(admin, {
        fundId,
        provider: providerType,
        model,
        feature: 'memo_agent_ingest',
        usage,
      })
      const doc = parsePerDocResponse(text, file.document_id)
      completed += 1
      await note(`Extracted ${completed}/${parsed.length}: ${file.file_name}`)
      return doc
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const detail = `AI extraction failed: ${msg}`
      warnings.push(`AI call failed for ${file.file_name}: ${msg}`)
      // Attach the specific failure reason to the file so it lands in
      // diligence_documents.parse_notes — replaces the unhelpful generic
      // "AI extraction failed" message users were seeing.
      file.errors.push(detail)
      completed += 1
      await note(`Extracted ${completed}/${parsed.length}: ${file.file_name} (failed)`)
      return null
    }
  }

  const perDocResults: Array<IngestionDocumentOutput | null> = new Array(parsed.length).fill(null)
  for (let i = 0; i < parsed.length; i += CONCURRENCY) {
    const slice = parsed.slice(i, i + CONCURRENCY)
    const chunkResults = await Promise.all(slice.map(processFile))
    for (let j = 0; j < chunkResults.length; j++) {
      perDocResults[i + j] = chunkResults[j]
    }
  }

  const documents = perDocResults.filter((d): d is IngestionDocumentOutput => d !== null)

  // Persist per-doc results to the draft. Synthesis fields stay empty arrays
  // until the synthesis job fills them in. When this is a partial re-run
  // (documentIds is set), merge the new docs with the previously-stored set
  // by document_id so we don't clobber the successful results from the prior
  // run.
  await note('Writing per-document output to draft…')
  const isPartialRun = Array.isArray(documentIds) && documentIds.length > 0
  const draftId = await persistDocsToDraft(admin, fundId, dealId, documents, params.draftId, isPartialRun)

  await note('Updating document classifications…')
  const successIds = new Set(documents.map(d => d.document_id))
  await Promise.all([
    ...documents.map(doc =>
      admin
        .from('diligence_documents')
        .update({
          detected_type: doc.detected_type,
          type_confidence: doc.type_confidence,
          parse_status: 'parsed',
        } as any)
        .eq('id', doc.document_id)
        .eq('deal_id', dealId)
        .eq('fund_id', fundId)
    ),
    ...parsed
      .filter(file => !successIds.has(file.document_id))
      .map(file =>
        admin
          .from('diligence_documents')
          .update({
            parse_status: 'failed',
            parse_notes: file.errors.length > 0 ? file.errors.join('; ') : 'AI extraction failed',
          } as any)
          .eq('id', file.document_id)
          .eq('deal_id', dealId)
          .eq('fund_id', fundId)
      ),
  ])

  // Bump the deal stage forward when it's still on 'ingest'. Don't regress if
  // the deal is already further along (e.g. a partial re-run of failed docs
  // while the deal is in 'qa' or 'draft' should not bounce it back).
  await admin
    .from('diligence_deals')
    .update({ current_memo_stage: 'research' } as any)
    .eq('id', dealId)
    .eq('fund_id', fundId)
    .eq('current_memo_stage', 'ingest')

  return {
    draft_id: draftId,
    ingestion_documents: documents,
    documents_processed: documents.length,
    warnings,
  }
}

/**
 * Stage 1B — cross-document synthesis.
 *
 * Reads the documents array from the latest draft and runs one synthesis AI
 * call to produce gap_analysis + cross_doc_flags. The synthesis input is just
 * summaries and claim fields — the raw documents are not re-sent.
 */
export async function runIngestSynthesis(params: {
  admin: Admin
  fundId: string
  dealId: string
  draftId?: string
  progressCb?: (msg: string) => Promise<void>
}): Promise<IngestionSynthesisResult> {
  const { admin, fundId, dealId, progressCb } = params
  const note = async (msg: string) => { if (progressCb) await progressCb(msg) }

  await note('Loading draft…')
  const draft = await loadDraft(admin, fundId, dealId, params.draftId)
  if (!draft) {
    throw new Error('No draft found to synthesize. Run ingest first.')
  }
  const draftId = draft.id
  const ingestion = (draft.ingestion_output ?? {}) as Partial<IngestionOutput>
  const documents = Array.isArray(ingestion.documents) ? ingestion.documents : []

  const warnings: string[] = []

  if (documents.length === 0) {
    warnings.push('No documents in draft; skipping synthesis.')
    return {
      draft_id: draftId,
      gap_analysis: { missing: [], inadequate: [] },
      cross_doc_flags: [],
      warnings,
    }
  }

  await note('Building system prompt…')
  const { prompt: system } = await buildSystemPrompt({ admin, fundId, stage: 'ingest' })

  await note('Loading deal record…')
  const { data: dealRow } = await admin
    .from('diligence_deals')
    .select('name, stage_at_consideration')
    .eq('id', dealId)
    .eq('fund_id', fundId)
    .maybeSingle()
  const dealName = (dealRow as { name: string } | null)?.name ?? 'this deal'
  const dealStage = (dealRow as { stage_at_consideration: string | null } | null)?.stage_at_consideration ?? null

  // We don't have the original file_names on the draft — best effort: look
  // them up by document_id so the synthesis prompt mentions human names.
  const docIds = documents.map(d => d.document_id).filter(Boolean)
  const { data: docRows } = await admin
    .from('diligence_documents')
    .select('id, file_name')
    .in('id', docIds.length > 0 ? docIds : ['00000000-0000-0000-0000-000000000000'])
    .eq('deal_id', dealId)
    .eq('fund_id', fundId)
  const nameById = new Map<string, string>()
  for (const row of (docRows ?? []) as Array<{ id: string; file_name: string }>) {
    nameById.set(row.id, row.file_name)
  }

  const { provider, model, providerType } = await getStageProvider(admin, fundId, 'ingest')

  // Repair previously-stored detected_types that the model returned in
  // freeform shape (e.g. "Pitch Deck" instead of "pitch_deck"). Without this
  // the synthesis call can't match docs against the schema's expected_documents
  // list and incorrectly flags them as missing. Normalization is idempotent.
  const normalizedDocs = documents.map(d => ({
    ...d,
    detected_type: normalizeTypeId(d.detected_type),
  }))

  await note(`Synthesizing gap analysis across ${normalizedDocs.length} document${normalizedDocs.length === 1 ? '' : 's'}…`)
  let gapAnalysis: IngestionOutput['gap_analysis'] = { missing: [], inadequate: [] }
  let crossDocFlags: IngestionOutput['cross_doc_flags'] = []

  try {
    const synthesisContent = buildIngestSynthesisContent({
      dealName,
      stage: dealStage,
      perDoc: normalizedDocs.map(d => ({
        document_id: d.document_id,
        file_name: nameById.get(d.document_id) ?? d.document_id,
        detected_type: d.detected_type,
        summary: d.summary,
        claim_fields: d.claims.map(c => c.field),
        claim_values: d.claims.map(c => ({ field: c.field, value: c.value })),
      })),
    })

    const { text, usage } = await provider.createMessage({
      model,
      maxTokens: 4096,
      system,
      content: synthesisContent,
    })
    logAIUsage(admin, {
      fundId,
      provider: providerType,
      model,
      feature: 'memo_agent_ingest_synthesis',
      usage,
    })
    const synth = parseSynthesisResponse(text)
    gapAnalysis = synth.gap_analysis
    crossDocFlags = synth.cross_doc_flags
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warnings.push(`Synthesis call failed: ${msg}. Per-document results are preserved.`)
  }

  await note('Writing synthesis output to draft…')
  // Persist normalized docs back to the draft so subsequent reads (UI display,
  // future synthesis runs) see canonical IDs instead of the legacy "Pitch Deck"
  // freeform values.
  const mergedOutput: IngestionOutput = {
    documents: normalizedDocs,
    gap_analysis: gapAnalysis,
    cross_doc_flags: crossDocFlags,
  }
  const { error: updateErr } = await admin
    .from('diligence_memo_drafts')
    .update({ ingestion_output: mergedOutput as any })
    .eq('id', draftId)
    .eq('deal_id', dealId)
    .eq('fund_id', fundId)
  if (updateErr) {
    throw new Error(`Failed to write synthesis to draft: ${updateErr.message}`)
  }

  // Also update the diligence_documents.detected_type for any rows where the
  // normalized form differs from what's stored. This keeps the documents list
  // UI in sync with the canonical IDs.
  await Promise.all(normalizedDocs.map(d => {
    const original = documents.find(o => o.document_id === d.document_id)
    if (!original || original.detected_type === d.detected_type) return Promise.resolve()
    return admin
      .from('diligence_documents')
      .update({ detected_type: d.detected_type } as any)
      .eq('id', d.document_id)
      .eq('deal_id', dealId)
      .eq('fund_id', fundId)
  }))

  return {
    draft_id: draftId,
    gap_analysis: gapAnalysis,
    cross_doc_flags: crossDocFlags,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Persist helpers
// ---------------------------------------------------------------------------

async function persistDocsToDraft(
  admin: Admin,
  fundId: string,
  dealId: string,
  newDocs: IngestionDocumentOutput[],
  draftId?: string,
  isPartialRun?: boolean,
): Promise<string> {
  // Find the target draft row.
  let targetId = draftId ?? null
  let existingIngestion: Partial<IngestionOutput> = {}

  if (!targetId) {
    const { data: existing } = await admin
      .from('diligence_memo_drafts')
      .select('id, ingestion_output')
      .eq('deal_id', dealId)
      .eq('fund_id', fundId)
      .eq('is_draft', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existing) {
      targetId = (existing as { id: string }).id
      existingIngestion = ((existing as any).ingestion_output ?? {}) as Partial<IngestionOutput>
    }
  } else {
    const { data: row } = await admin
      .from('diligence_memo_drafts')
      .select('ingestion_output')
      .eq('id', targetId)
      .eq('deal_id', dealId)
      .eq('fund_id', fundId)
      .maybeSingle()
    existingIngestion = ((row as any)?.ingestion_output ?? {}) as Partial<IngestionOutput>
  }

  // Merge: on a partial run, keep existing docs not in newDocs and overwrite
  // those that match by document_id. On a full run, replace entirely.
  const mergedDocuments: IngestionDocumentOutput[] = (() => {
    if (!isPartialRun) return newDocs
    const newIds = new Set(newDocs.map(d => d.document_id))
    const prior = Array.isArray(existingIngestion.documents) ? existingIngestion.documents : []
    const keptPrior = prior.filter(d => !newIds.has(d.document_id))
    return [...keptPrior, ...newDocs]
  })()

  // Preserve prior gap_analysis + cross_doc_flags on a partial run so the
  // user keeps visibility while the synthesis job re-runs. Full runs clear.
  const mergedOutput: IngestionOutput = {
    documents: mergedDocuments,
    gap_analysis: isPartialRun && existingIngestion.gap_analysis
      ? existingIngestion.gap_analysis as IngestionOutput['gap_analysis']
      : { missing: [], inadequate: [] },
    cross_doc_flags: isPartialRun && Array.isArray(existingIngestion.cross_doc_flags)
      ? existingIngestion.cross_doc_flags
      : [],
  }

  if (targetId) {
    const { error } = await admin
      .from('diligence_memo_drafts')
      .update({ ingestion_output: mergedOutput as any })
      .eq('id', targetId)
      .eq('deal_id', dealId)
      .eq('fund_id', fundId)
    if (error) throw new Error(`Failed to update draft: ${error.message}`)
    return targetId
  }

  const version = `v0.1-ingest-${new Date().toISOString().slice(0, 10)}`
  const { data: created, error: insertErr } = await admin
    .from('diligence_memo_drafts')
    .insert({
      deal_id: dealId,
      fund_id: fundId,
      draft_version: version,
      agent_version: 'memo-agent v0.1',
      ingestion_output: mergedOutput as any,
    } as any)
    .select('id')
    .single()
  if (insertErr || !created) throw new Error(`Failed to create draft: ${insertErr?.message ?? 'unknown'}`)
  return (created as { id: string }).id
}

async function loadDraft(
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
      .eq('deal_id', dealId)
      .eq('fund_id', fundId)
      .maybeSingle()
    return data as { id: string; ingestion_output: unknown } | null
  }
  const { data } = await admin
    .from('diligence_memo_drafts')
    .select('id, ingestion_output')
    .eq('deal_id', dealId)
    .eq('fund_id', fundId)
    .eq('is_draft', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as { id: string; ingestion_output: unknown } | null
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parsePerDocResponse(raw: string, expectedDocId: string): IngestionDocumentOutput {
  const parsed = extractJsonObject(raw)
  const doc = coerceDocument(parsed)
  if (!doc) throw new Error(`Ingest AI response missing required fields: ${JSON.stringify(parsed).slice(0, 300)}`)
  doc.document_id = expectedDocId
  return doc
}

function parseSynthesisResponse(raw: string): { gap_analysis: IngestionOutput['gap_analysis']; cross_doc_flags: IngestionOutput['cross_doc_flags'] } {
  const parsed = extractJsonObject(raw)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Synthesis AI returned non-object JSON')
  }
  const obj = parsed as Record<string, unknown>
  const gap = (obj.gap_analysis as any) ?? {}
  return {
    gap_analysis: {
      missing: Array.isArray(gap.missing) ? gap.missing.map(coerceGap).filter(Boolean) as IngestionGap[] : [],
      inadequate: Array.isArray(gap.inadequate) ? gap.inadequate.map(coerceGap).filter(Boolean) as IngestionGap[] : [],
    },
    cross_doc_flags: Array.isArray(obj.cross_doc_flags) ? obj.cross_doc_flags as IngestionOutput['cross_doc_flags'] : [],
  }
}

// Canonicalize whatever the model returned into the schema's snake_case ID
// form. "Pitch Deck" → "pitch_deck", "Pitch-Deck" → "pitch_deck". Idempotent
// for already-snake values. Without this, synthesis's gap_analysis can't
// match the doc against the schema's expected_documents list and incorrectly
// flags documents as missing.
function normalizeTypeId(s: string): string {
  return s.toLowerCase().trim().replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_]/g, '')
}

function coerceDocument(raw: unknown): IngestionDocumentOutput | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.document_id !== 'string' || typeof r.detected_type !== 'string') return null
  const conf = ['low', 'medium', 'high'].includes(r.type_confidence as string) ? r.type_confidence as 'low' | 'medium' | 'high' : 'low'
  return {
    document_id: r.document_id,
    detected_type: normalizeTypeId(r.detected_type),
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

export type { ParsedFile }
