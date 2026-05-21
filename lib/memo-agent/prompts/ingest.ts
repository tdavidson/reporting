import type { ContentBlock } from '@/lib/ai/types'
import type { ParsedFile } from '@/lib/memo-agent/ingestion/parsers'

// Matches the truncation budget in lib/parsing/extractAttachmentText.ts so
// the shared extractor's output reaches the model without further clipping.
const PER_FILE_TEXT_BUDGET = 50_000

/**
 * Build the user-content payload for a single-document ingest call.
 *
 * The ingest stage fans out one AI call per document so the work fits inside
 * the 120s Vercel function ceiling. Cross-doc analysis (gap_analysis,
 * cross_doc_flags) is handled by a separate synthesis call — see
 * `buildIngestSynthesisContent`.
 */
export function buildIngestDocContent(params: {
  dealName: string
  file: ParsedFile
  manifest: Array<{ file_name: string; file_format: string; detected_type: string | null }>
}): ContentBlock[] {
  const { file } = params
  const blocks: ContentBlock[] = []

  const manifestLines = params.manifest
    .map((m, i) => `  ${i + 1}. ${m.file_name} (${m.file_format}${m.detected_type ? `, heuristic: ${m.detected_type}` : ''})`)
    .join('\n')

  const textParts: string[] = [
    `Deal: ${params.dealName}`,
    '',
    `Full data-room manifest (${params.manifest.length} documents — for context only; you are analyzing one of them):`,
    manifestLines,
    '',
    `Target document for this call: ${file.file_name} (doc_id=${file.document_id})${file.detected_type ? `, heuristic type=${file.detected_type}` : ''}`,
    '',
    INGEST_DOC_INSTRUCTIONS,
    '',
  ]

  if (file.text) {
    const slice = file.text.slice(0, PER_FILE_TEXT_BUDGET)
    textParts.push(`<document file="${file.file_name}" doc_id="${file.document_id}">`, slice, '</document>')
  }

  blocks.push({ type: 'text', text: textParts.join('\n') })

  if (file.base64 && file.media_type) {
    if (file.media_type === 'application/pdf') {
      blocks.push({ type: 'document', mediaType: 'application/pdf', data: file.base64 })
    } else if (file.media_type.startsWith('image/')) {
      blocks.push({ type: 'image', mediaType: file.media_type, data: file.base64 })
    }
  }

  return blocks
}

/**
 * Build the synthesis-call user content. Runs once after per-doc fan-out
 * completes, using only summaries + claim fields (cheap and fast) to produce
 * gap_analysis + cross_doc_flags.
 */
export function buildIngestSynthesisContent(params: {
  dealName: string
  perDoc: Array<{
    document_id: string
    file_name: string
    detected_type: string
    summary: string
    claim_fields: string[]
    claim_values: Array<{ field: string; value: string }>
  }>
}): ContentBlock[] {
  const lines: string[] = [
    `Deal: ${params.dealName}`,
    '',
    'Per-document ingestion summaries (from the per-doc fan-out you just completed):',
    '',
  ]
  for (const doc of params.perDoc) {
    lines.push(`### ${doc.file_name} (doc_id=${doc.document_id}, type=${doc.detected_type})`)
    lines.push(doc.summary || '(no summary)')
    if (doc.claim_values.length > 0) {
      lines.push('Claims:')
      for (const c of doc.claim_values.slice(0, 30)) {
        lines.push(`  - ${c.field}: ${c.value}`)
      }
    }
    lines.push('')
  }
  lines.push(INGEST_SYNTHESIS_INSTRUCTIONS)

  return [{ type: 'text', text: lines.join('\n') }]
}

const INGEST_DOC_INSTRUCTIONS = `STAGE 1 — DATA ROOM INGESTION (per-document call)

For the target document only, produce a structured ingestion record per data_room_ingestion.yaml. Do NOT analyze other documents in this call — they're listed only for naming context.

  1. Classify the document per data_room_ingestion.yaml document_types. The detected_type field MUST be the exact \`id\` string from that schema (lowercase, snake_case — e.g. "pitch_deck", "financial_model", "cap_table"). Do not invent new IDs, do not title-case, do not pluralize. Use "unknown" only if none of the schema IDs fit.
  2. Extract claim_record entries per the schema. Mark every claim as company-stated (this stage does no verification).
  3. Note inadequacies on the issues field if the document is incomplete, illegible, or missing key sections.

Return JSON ONLY, conforming exactly to:

{
  "document_id": string,                  // must match the target doc_id above
  "detected_type": string,                // from data_room_ingestion.yaml document_types
  "type_confidence": "low" | "medium" | "high",
  "summary": string,                      // 1-3 sentences describing what this document is
  "claims": [
    {
      "id": string,                       // stable: "claim_<doc>_<n>"
      "field": string,                    // e.g. "ARR_q4_2025"
      "value": string,                    // raw value as stated, with units
      "context": string,                  // surrounding sentence or table label
      "verification_status": "unverified",
      "criticality": "high" | "medium" | "low"
    }
  ],
  "issues": [string]                      // optional inadequacies
}

Do not produce a memo, recommendation, gap analysis across the data room, or rubric scores in this stage.`

const INGEST_SYNTHESIS_INSTRUCTIONS = `STAGE 1 — DATA ROOM INGESTION (synthesis)

Using ONLY the per-document summaries and claims above (you do not have the raw documents), produce the data-room-wide gap and cross-doc analysis per data_room_ingestion.yaml:

  1. gap_analysis.missing — expected document types from the schema that aren't present in the manifest.
  2. gap_analysis.inadequate — documents present but flagged as incomplete (use the per-doc issues fields).
  3. cross_doc_flags — multi-doc inconsistencies (e.g. cap table revenue vs financial model revenue). Surface as flags only; do not resolve.

Return JSON ONLY:

{
  "gap_analysis": {
    "missing":    [{"expected_type": string, "criticality": "blocker" | "important" | "nice_to_have", "rationale": string}],
    "inadequate": [{"document_id": string,   "criticality": "blocker" | "important" | "nice_to_have", "rationale": string}]
  },
  "cross_doc_flags": [{"description": string, "doc_ids": [string]}]
}`
