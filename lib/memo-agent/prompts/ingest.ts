import type { ContentBlock } from '@/lib/ai/types'
import type { ParsedFile } from '@/lib/memo-agent/ingestion/parsers'

const PER_FILE_TEXT_BUDGET = 30_000
const TOTAL_TEXT_BUDGET = 240_000

/**
 * Build the user-content payload for the ingest stage. PDFs and images are
 * passed natively as document/image blocks; text-based files are concatenated
 * into one big text block with file dividers.
 */
export function buildIngestUserContent(params: {
  dealName: string
  files: ParsedFile[]
}): ContentBlock[] {
  const blocks: ContentBlock[] = []

  // Lead text block: instructions + manifest + extracted text.
  const manifest = params.files.map((f, i) => `  ${i + 1}. ${f.file_name} (${f.file_format}${f.detected_type ? `, heuristic type: ${f.detected_type}` : ''})`).join('\n')

  const textParts: string[] = [
    `Deal: ${params.dealName}`,
    '',
    `Documents in the deal room (${params.files.length} total):`,
    manifest,
    '',
    INGEST_INSTRUCTIONS,
    '',
  ]

  let textBudget = TOTAL_TEXT_BUDGET
  for (const f of params.files) {
    if (!f.text || textBudget <= 0) continue
    const slice = f.text.slice(0, Math.min(PER_FILE_TEXT_BUDGET, textBudget))
    textParts.push(`<document file="${f.file_name}" doc_id="${f.document_id}">`, slice, '</document>', '')
    textBudget -= slice.length
  }

  blocks.push({ type: 'text', text: textParts.join('\n') })

  // Native document blocks (PDFs) and image blocks come after the text.
  for (const f of params.files) {
    if (!f.base64 || !f.media_type) continue
    if (f.media_type === 'application/pdf') {
      blocks.push({ type: 'document', mediaType: 'application/pdf', data: f.base64 })
    } else if (f.media_type.startsWith('image/')) {
      blocks.push({ type: 'image', mediaType: f.media_type, data: f.base64 })
    }
  }

  return blocks
}

const INGEST_INSTRUCTIONS = `STAGE 1 — DATA ROOM INGESTION

For each document above, produce a structured ingestion_output that conforms to data_room_ingestion.yaml's schema. Specifically:

  1. Classify each document per data_room_ingestion.yaml document_types. Override the heuristic type if you disagree, with rationale.
  2. Extract claim_record entries per the schema. Mark every claim as company-stated (this stage does no verification — that's Stage 2).
  3. Run gap_analysis: which expected_documents are missing? Which present documents are inadequate?
  4. Note multi-doc inconsistencies (e.g. cap table revenue vs. financial model revenue) but do NOT resolve them — surface as flags.

Return JSON ONLY, conforming exactly to:

{
  "documents": [
    {
      "document_id": string,                  // matches doc_id in <document> tags above
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
      "issues": [string]                       // optional inadequacies
    }
  ],
  "gap_analysis": {
    "missing": [{"expected_type": string, "criticality": "blocker" | "important" | "nice_to_have", "rationale": string}],
    "inadequate": [{"document_id": string, "criticality": "blocker" | "important" | "nice_to_have", "rationale": string}]
  },
  "cross_doc_flags": [{"description": string, "doc_ids": [string]}]
}

Do not produce a memo, recommendation, or rubric scores in this stage.`
