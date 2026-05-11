import type { ContentBlock } from '@/lib/ai/types'
import type { IngestionOutput } from '@/lib/memo-agent/stages/ingest'

export interface ResearchPromptInput {
  dealName: string
  ingestion: IngestionOutput
  /** Whether the AI provider has external web search wired up (v1.5+). */
  webSearchEnabled: boolean
}

export function buildResearchUserContent(input: ResearchPromptInput): ContentBlock[] {
  const ingestionSummary = summarizeIngestion(input.ingestion)
  const text = [
    `Deal: ${input.dealName}`,
    '',
    `=== STAGE 1 INGESTION OUTPUT (data-room facts as company-stated, unverified) ===`,
    ingestionSummary,
    '',
    input.webSearchEnabled ? RESEARCH_INSTRUCTIONS_WITH_WEB : RESEARCH_INSTRUCTIONS_NO_WEB,
  ].join('\n')

  return [{ type: 'text', text }]
}

function summarizeIngestion(out: IngestionOutput): string {
  const parts: string[] = []
  for (const doc of out.documents) {
    parts.push(`# Document: ${doc.document_id} (${doc.detected_type})`)
    if (doc.summary) parts.push(doc.summary)
    if (doc.claims.length > 0) {
      parts.push(`Claims (${doc.claims.length}):`)
      for (const c of doc.claims) {
        parts.push(`  • [${c.criticality}] ${c.field} = ${c.value}${c.context ? ` (${c.context})` : ''}`)
      }
    }
  }
  if (out.gap_analysis.missing.length > 0) {
    parts.push(`# Missing documents`)
    for (const g of out.gap_analysis.missing) parts.push(`  • [${g.criticality}] ${g.expected_type ?? 'unknown'}: ${g.rationale}`)
  }
  if (out.cross_doc_flags.length > 0) {
    parts.push(`# Cross-doc inconsistencies`)
    for (const f of out.cross_doc_flags) parts.push(`  • ${f.description} (docs: ${f.doc_ids.join(', ')})`)
  }
  return parts.join('\n')
}

const RESEARCH_COMMON = `STAGE 2 — EXTERNAL RESEARCH

Per research_dossier.yaml, your job is to verify or contradict company claims, surface unnamed competitors, and produce founder dossiers — without fabricating sources.

Hard rules for this stage:
  - No LinkedIn scraping, even via third-party APIs.
  - When you cite a fact, name the source. No general "industry sources say…".
  - Distinguish company-stated claims (verification_status: company_stated) from independently-verified ones (verification_status: verified) and contradicted ones (verification_status: contradicted).
  - Competitors named by the company go in competitive_map.named_by_company; competitors you identify go in competitive_map.named_by_research.

Return JSON ONLY, conforming exactly to:

{
  "findings": [
    {
      "id": string,
      "claim_ref": string|null,           // claim id from ingestion if verifying
      "topic": string,                     // e.g. "ARR", "competitor X funding"
      "verification_status": "verified" | "contradicted" | "company_stated" | "inconclusive",
      "evidence": string,                  // 1-3 sentences, with source names
      "sources": [{"title": string, "url": string|null, "tier": "tier_1"|"tier_2"|"tier_3"}]
    }
  ],
  "contradictions": [
    {
      "topic": string,
      "claim_ref": string|null,
      "description": string,
      "severity": "material" | "minor"
    }
  ],
  "competitive_map": {
    "named_by_company": [{"name": string, "note": string}],
    "named_by_research": [{"name": string, "rationale": string, "sources": [{"title": string, "url": string|null}]}]
  },
  "founder_dossiers": [
    {
      "founder_name": string,
      "role": string,
      "background_summary": string,
      "sources": [{"title": string, "url": string|null}],
      "open_questions": [string]
    }
  ],
  "research_gaps": [
    {"topic": string, "rationale": string, "criticality": "blocker" | "important" | "nice_to_have"}
  ],
  "research_mode": "with_web_search" | "no_web_search"
}

Do not fabricate URLs. When you cannot verify externally, say so via research_gaps.`

const RESEARCH_INSTRUCTIONS_WITH_WEB = `${RESEARCH_COMMON}

Web search is available — use it to verify material claims. Set "research_mode": "with_web_search".`

const RESEARCH_INSTRUCTIONS_NO_WEB = `${RESEARCH_COMMON}

Web search is NOT available in this stage. You may use your training-time knowledge only — and only when you can name a specific source. For everything else, list it as a research_gap. Set "research_mode": "no_web_search".`
