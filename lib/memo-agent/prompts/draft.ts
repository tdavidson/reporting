import type { ContentBlock } from '@/lib/ai/types'
import type { IngestionOutput } from '@/lib/memo-agent/stages/ingest'
import type { ResearchOutput } from '@/lib/memo-agent/stages/research'

export interface QARecord {
  question_id: string
  answer_text: string
  feeds_dimensions?: string[]
  category?: string | null
}

/** A planned (not-yet-written) paragraph from the outline pass. */
export interface OutlineParagraph {
  id: string
  section_id: string
  order: number
  topic: string
}

export interface OutlineSection {
  section_id: string
  paragraphs: OutlineParagraph[]
}

/**
 * Stage 4A — outline pass. Plans the memo structure without writing prose.
 * Small output (skeletons only) so it always fits comfortably; the heavy
 * prose generation is fanned out across per-section fill calls.
 */
export function buildDraftOutlineContent(params: {
  dealName: string
  memoOutputYaml: string
  ingestion: IngestionOutput
  research: ResearchOutput | null
  qa_answers: QARecord[]
}): ContentBlock[] {
  const text = [
    `Deal: ${params.dealName}`,
    '',
    `=== STAGE 4A — MEMO OUTLINE ===`,
    `Plan the memo structure. Do NOT write prose in this call.`,
    '',
    `--- MEMO SCHEMA (memo_output.yaml — section list is authoritative) ---`,
    params.memoOutputYaml,
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
    OUTLINE_INSTRUCTIONS,
  ].join('\n')

  return [{ type: 'text', text }]
}

/**
 * Stage 4B — section fill. Writes prose for one batch of outlined sections.
 * Each fill call gets the full source data (for correct citation) plus the
 * complete section topic list (so it doesn't repeat content covered
 * elsewhere) but only writes the sections in `sectionsToWrite`.
 */
export function buildDraftSectionFillContent(params: {
  dealName: string
  sectionsToWrite: OutlineSection[]
  allSectionTopics: Array<{ section_id: string; topics: string[] }>
  ingestion: IngestionOutput
  research: ResearchOutput | null
  qa_answers: QARecord[]
}): ContentBlock[] {
  const planLines: string[] = []
  for (const sec of params.sectionsToWrite) {
    planLines.push(`## Section: ${sec.section_id}`)
    for (const p of sec.paragraphs) {
      planLines.push(`  - paragraph ${p.id} (order ${p.order}): ${p.topic}`)
    }
  }

  const fullMemoShape = params.allSectionTopics
    .map(s => `  - ${s.section_id}: ${s.topics.join(' | ')}`)
    .join('\n')

  const text = [
    `Deal: ${params.dealName}`,
    '',
    `=== STAGE 4B — WRITE MEMO SECTIONS ===`,
    `Write the prose for ONLY the sections planned below. Other sections are`,
    `written separately — the full memo shape is listed so you avoid repeating`,
    `content that belongs elsewhere.`,
    '',
    `--- FULL MEMO SHAPE (for context — do NOT write these) ---`,
    fullMemoShape,
    '',
    `--- SECTIONS TO WRITE IN THIS CALL ---`,
    planLines.join('\n'),
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
    SECTION_FILL_INSTRUCTIONS,
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

/**
 * Stage 4C — review pass. A stronger model reads the assembled first draft
 * and returns ONLY the paragraphs that need improvement (targeted edits), so
 * the output stays small enough to fit a single call.
 */
export function buildDraftReviewContent(params: {
  dealName: string
  paragraphs: Array<{ id: string; section_id: string; prose: string }>
  ingestion: IngestionOutput
  research: ResearchOutput | null
  qa_answers: QARecord[]
}): ContentBlock[] {
  const memoLines: string[] = []
  for (const p of params.paragraphs) {
    memoLines.push(`### ${p.section_id} — paragraph ${p.id}`)
    memoLines.push(p.prose || '(empty)')
    memoLines.push('')
  }

  const text = [
    `Deal: ${params.dealName}`,
    '',
    `=== STAGE 4C — MEMO REVIEW & EDIT ===`,
    `Review the first-draft memo below. Return ONLY paragraphs that need`,
    `improvement — not the whole memo.`,
    '',
    `--- FIRST-DRAFT MEMO ---`,
    memoLines.join('\n'),
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
    REVIEW_INSTRUCTIONS,
  ].join('\n')

  return [{ type: 'text', text }]
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

const OUTLINE_INSTRUCTIONS = `Output JSON ONLY. Plan the memo — do NOT write prose.

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
  "sections": [
    {
      "section_id": string,                // matches a section id from memo_output.yaml
      "paragraphs": [
        {
          "id": string,                    // "p_<section>_<n>"
          "order": integer,
          "topic": string                  // ONE concise line (max 15 words): what this paragraph covers
        }
      ]
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

Planning rules:
  • Include every section from memo_output.yaml EXCEPT "scoring_summary" and "appendix" (those come from later stages).
  • The "recommendation" section gets exactly ONE paragraph with topic "[partner-only placeholder]".
  • The "team" section SHOULD plan MULTIPLE paragraphs: (a) factual_summary — per-founder background; (b) prior_work — what each founder built/shipped/led, with sourced specifics; (c) public_output — papers, talks, OSS, public writing; (d) references_to_qa — partner Q&A about the team. Plus placeholder paragraphs for character_assessment and founder_market_fit_judgment.
  • Keep each "topic" to one concise line. The section-fill step has the full source data and will pick exact citations — do not enumerate source ids here.
  • Surface unverified material claims, contradictions, gaps, missing Q&A, and partner_only blanks as partner_attention items now — they don't need prose.`

const SECTION_FILL_INSTRUCTIONS = `Output JSON ONLY. Write prose for the planned paragraphs.

{
  "paragraphs": [
    {
      "id": string,                        // echo the planned paragraph id
      "section_id": string,                // echo the planned section id
      "order": integer,                    // echo the planned order
      "prose": string,                     // Substantive. Target 4-6 sentences, 120-220 words — aim toward the upper end. Single-sentence or thin (<70 word) paragraphs are not acceptable; the partner should have enough context to evaluate without re-reading source material.
      "sources": [
        {
          "source_type": "claim" | "finding" | "qa_answer" | "assumption" | "partner_only" | "gap",
          "source_id": string,
          "span": string|null
        }
      ],
      "origin": "agent_drafted" | "partner_only_placeholder",
      "confidence": "low" | "medium" | "high" | "n/a",
      "contains_projection": boolean,
      "contains_unverified_claim": boolean,
      "contains_contradiction": boolean
    }
  ]
}

Hard rules:
  • Write a paragraph for every planned paragraph in the sections above — match the planned id, section_id, order.
  • If the plan includes the "recommendation" section: emit it as origin="partner_only_placeholder", prose="[Partner to complete]", sources=[], confidence="n/a", contains_*=false. Do NOT draft a recommendation.
  • Team placeholder paragraphs (character_assessment, founder_market_fit_judgment) get origin="partner_only_placeholder", prose="[Partner to complete]". Do NOT interpret character or fit. Do NOT score the team.
  • Every agent_drafted paragraph MUST have at least one source.
  • Every paragraph that mentions a forward-looking number sets contains_projection=true.
  • Every paragraph relying on an unverified claim sets contains_unverified_claim=true.
  • Cite source_ids that actually appear in the input data above. Never invent ids.`

const REVIEW_INSTRUCTIONS = `Output JSON ONLY. Return ONLY paragraphs that genuinely need improvement.

{
  "edits": [
    {
      "paragraph_id": string,            // must match a paragraph id from the first-draft memo above
      "revised_prose": string,           // the improved paragraph text
      "reason": string                   // one line: what was wrong and what you fixed
    }
  ]
}

Review for, in priority order:
  1. Sourcing accuracy — prose that asserts something the source data does not support, or that reads as verified when the underlying claim is company-stated/unverified.
  2. Thin paragraphs — anything under ~70 words or a single sentence. Expand to 120-220 words with substance from the source data.
  3. Cross-section repetition — if two paragraphs cover the same ground, tighten the weaker one.
  4. Voice and clarity — marketing language, hedging, or vague phrasing; make it crisp and partner-readable.

Rules:
  • Do NOT return paragraphs that are already good. An empty edits array is a valid response.
  • Do NOT rewrite partner_only_placeholder paragraphs (prose "[Partner to complete]"). Leave them alone.
  • Do NOT draft a recommendation or score the team.
  • revised_prose replaces the paragraph's prose verbatim — return the full improved paragraph, not a diff.`

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
