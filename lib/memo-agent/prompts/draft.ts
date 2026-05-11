import type { ContentBlock } from '@/lib/ai/types'
import type { IngestionOutput } from '@/lib/memo-agent/stages/ingest'
import type { ResearchOutput } from '@/lib/memo-agent/stages/research'

export interface QARecord {
  question_id: string
  answer_text: string
  feeds_dimensions?: string[]
  category?: string | null
}

export function buildDraftUserContent(params: {
  dealName: string
  memoOutputYaml: string
  rubricYaml: string
  ingestion: IngestionOutput
  research: ResearchOutput | null
  qa_answers: QARecord[]
}): ContentBlock[] {
  const text = [
    `Deal: ${params.dealName}`,
    '',
    `=== STAGE 4 — MEMO DRAFT ===`,
    `Produce a structured memo per memo_output.yaml. Cite every paragraph; never fabricate sources.`,
    '',
    `--- INGESTION OUTPUT (claims with verification_status) ---`,
    summarizeIngestion(params.ingestion),
    '',
    `--- RESEARCH OUTPUT ---`,
    params.research ? summarizeResearch(params.research) : '(none)',
    '',
    `--- PARTNER Q&A ANSWERS ---`,
    summarizeQA(params.qa_answers),
    '',
    DRAFT_INSTRUCTIONS,
  ].join('\n')

  return [{ type: 'text', text }]
}

export interface ScorePromptInput {
  dealName: string
  rubricYaml: string
  ingestion: IngestionOutput
  research: ResearchOutput | null
  qa_answers: QARecord[]
  memo_draft_output_summary: string
}

export function buildScoreUserContent(params: ScorePromptInput): ContentBlock[] {
  const text = [
    `Deal: ${params.dealName}`,
    '',
    `=== STAGE 5 — RUBRIC SCORING ===`,
    'Score every machine and hybrid dimension per the active rubric.yaml. Partner-only dimensions (e.g. team) get score=null and rationale containing supporting material.',
    '',
    `--- DRAFT MEMO (high-level) ---`,
    params.memo_draft_output_summary,
    '',
    `--- INGESTION CLAIMS ---`,
    summarizeIngestion(params.ingestion),
    '',
    `--- RESEARCH FINDINGS ---`,
    params.research ? summarizeResearch(params.research) : '(none)',
    '',
    `--- PARTNER Q&A ---`,
    summarizeQA(params.qa_answers),
    '',
    SCORE_INSTRUCTIONS,
  ].join('\n')

  return [{ type: 'text', text }]
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

const DRAFT_INSTRUCTIONS = `Output JSON ONLY, conforming to memo_output.yaml. Required shape:

{
  "header": {
    "company_name": string,
    "sector": string|null,
    "stage": string|null,
    "round_size": string|null,
    "deal_lead": null,                     // partner_only — leave null
    "memo_date": string,                   // ISO date
    "draft_version": string,
    "agent_version": "memo-agent v0.1"
  },
  "paragraphs": [
    {
      "id": string,                        // "p_<section>_<n>"
      "section_id": string,                // matches a section id from memo_output.yaml
      "order": integer,
      "prose": string,                     // Substantive paragraphs. Target 4-6 sentences, 120-220 words — aim toward the upper end. Single-sentence or thin (<70 word) paragraphs are not acceptable; the partner should have enough context to evaluate without re-reading the source material.
      "sources": [
        {
          "source_type": "claim" | "finding" | "qa_answer" | "assumption" | "partner_only" | "gap",
          "source_id": string,             // claim id, finding id, qa_answer question_id, etc.
          "span": string|null              // optional sentence-level attribution
        }
      ],
      "origin": "agent_drafted" | "partner_only_placeholder",
      "confidence": "low" | "medium" | "high" | "n/a",
      "contains_projection": boolean,
      "contains_unverified_claim": boolean,
      "contains_contradiction": boolean
    }
  ],
  "partner_attention": [
    {
      "kind": "unverified_material_claim" | "contradiction" | "data_room_gap" | "low_confidence_score" | "missing_qa" | "aggressive_assumption" | "partner_only_blank",
      "urgency": "must_address" | "should_address" | "fyi",
      "body": string,
      "links": [{ "source_type": string, "source_id": string }]
    }
  ]
}

Hard rules:
  • The "recommendation" section MUST be a single paragraph with origin="partner_only_placeholder", prose="[Partner to complete]", sources=[], confidence="n/a", contains_*=false. Do NOT draft a recommendation, even tentatively.
  • The "team" section is hybrid and SHOULD have MULTIPLE agent-drafted paragraphs covering:
      (a) factual_summary — per-founder background: name, role, prior companies/positions, education, years in domain;
      (b) prior_work — what each founder built / shipped / led at prior companies, with sourced specifics not generic descriptions;
      (c) public_output — papers, talks, OSS commits, public writing that demonstrates relevant expertise;
      (d) references_to_qa — verbatim partner Q&A answers about the team where provided.
    Then add partner_only_placeholder paragraphs for character_assessment and founder_market_fit_judgment.
    Do NOT score the team. Do NOT interpret character or fit — just compile the factual material so the partner can form a judgment with rich context.
  • Every prose paragraph (origin=agent_drafted) MUST have at least one source.
  • Every paragraph that mentions a forward-looking number sets contains_projection=true.
  • Every paragraph relying on an unverified claim sets contains_unverified_claim=true.
  • Cite source_ids that actually appear in the input data above. Never invent IDs.
  • Surface unverified material claims, contradictions, gaps, missing Q&A, and partner_only blanks as partner_attention items.
  • Skip the "scoring_summary" and "appendix" sections — those come from later stages.`

const SCORE_INSTRUCTIONS = `Output JSON ONLY:

{
  "scores": [
    {
      "dimension_id": string,                  // from rubric.yaml dimensions
      "mode": "machine" | "hybrid" | "partner_only",  // echo from rubric
      "score": integer|null,                   // 1-5; null when partner_only or low_confidence
      "confidence": "low" | "medium" | "high" | null,
      "rationale": string,                     // 1-3 sentences. For partner_only this is supporting material, not a justification
      "supporting_evidence": [
        { "source_type": "claim" | "finding" | "qa_answer", "source_id": string }
      ]
    }
  ],
  "low_confidence_attention": [
    { "dimension_id": string, "reason": string }
  ]
}

Hard rules:
  • Partner-only dimensions (mode=partner_only): score=null, confidence=null, rationale = compiled supporting material.
  • For machine and hybrid dimensions, only assign a numeric score when confidence ≥ medium. Otherwise leave score=null and surface the dimension in low_confidence_attention.
  • The "team" dimension is partner-only — never produce a numeric team score.`

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

function summarizeIngestion(out: IngestionOutput): string {
  const parts: string[] = []
  for (const doc of out.documents) {
    parts.push(`# ${doc.detected_type} (${doc.document_id})`)
    if (doc.summary) parts.push(doc.summary)
    for (const c of doc.claims) {
      parts.push(`  • [${c.criticality}] ${c.id} · ${c.field} = ${c.value}${c.context ? ` (${c.context})` : ''}`)
    }
  }
  if (out.gap_analysis.missing.length > 0) {
    parts.push(`# Missing`)
    for (const g of out.gap_analysis.missing) parts.push(`  • [${g.criticality}] ${g.expected_type ?? '?'}: ${g.rationale}`)
  }
  if (out.cross_doc_flags.length > 0) {
    parts.push(`# Cross-doc flags`)
    for (const f of out.cross_doc_flags) parts.push(`  • ${f.description}`)
  }
  return parts.join('\n')
}

function summarizeResearch(out: ResearchOutput): string {
  const parts: string[] = []
  for (const f of out.findings) {
    parts.push(`finding ${f.id} [${f.verification_status}] ${f.topic}: ${f.evidence}`)
  }
  for (const c of out.contradictions) {
    parts.push(`contradiction (${c.severity}) ${c.topic}: ${c.description}`)
  }
  for (const g of out.research_gaps) {
    parts.push(`gap [${g.criticality}] ${g.topic}: ${g.rationale}`)
  }
  for (const f of out.founder_dossiers) {
    parts.push(`founder ${f.founder_name} (${f.role}): ${f.background_summary}`)
  }
  return parts.join('\n')
}

function summarizeQA(records: QARecord[]): string {
  if (records.length === 0) return '(no Q&A captured)'
  return records.map(r => `${r.question_id}${r.category ? ` [${r.category}]` : ''}: ${r.answer_text}`).join('\n')
}
