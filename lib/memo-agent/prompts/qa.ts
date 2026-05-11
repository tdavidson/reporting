import type { ContentBlock } from '@/lib/ai/types'
import type { IngestionOutput } from '@/lib/memo-agent/stages/ingest'
import type { ResearchOutput } from '@/lib/memo-agent/stages/research'

export interface QAQuestion {
  id: string
  category: string
  prompt: string
  intent: string
  kind: string
  feeds_dimensions: string[]
  sensitivity: 'standard' | 'high'
  skip_if_covered_in?: string[]
}

export interface PriorAnswer {
  question_id: string
  answer_text: string
  partner_id: string | null
  answered_at: string
}

export function buildQAUserContent(params: {
  dealName: string
  ingestion: IngestionOutput | null
  research: ResearchOutput | null
  /** Pool of questions still candidate for asking (already filters out asked IDs). */
  candidates: QAQuestion[]
  prior_answers: PriorAnswer[]
  /** From batching_rules.questions_per_batch */
  batch_min: number
  batch_max: number
}): ContentBlock[] {
  const text = [
    `Deal: ${params.dealName}`,
    '',
    `=== STAGE 3 — PARTNER Q&A ===`,
    `Pick the next batch of ${params.batch_min}–${params.batch_max} questions from the candidate pool.`,
    `Apply skip logic against the ingestion output, research output, and prior session answers below. Any candidate whose answer is already evident should be marked covered with a one-line rationale; do not ask it.`,
    '',
    `=== INGESTION OUTPUT (summarized) ===`,
    summarizeIngestion(params.ingestion),
    '',
    `=== RESEARCH OUTPUT (summarized) ===`,
    summarizeResearch(params.research),
    '',
    `=== PRIOR ANSWERS IN THIS SESSION ===`,
    params.prior_answers.length
      ? params.prior_answers.map(a => `- [${a.question_id}] ${a.answer_text}`).join('\n')
      : '(no prior answers yet)',
    '',
    `=== CANDIDATE QUESTIONS (id · category · prompt · intent) ===`,
    params.candidates.map(q => `- ${q.id} · ${q.category} · "${q.prompt}" · ${q.intent}`).join('\n'),
    '',
    QA_INSTRUCTIONS,
  ].join('\n')

  return [{ type: 'text', text }]
}

const QA_INSTRUCTIONS = `Return JSON ONLY:

{
  "batch": [
    {
      "question_id": string,                   // id from candidate list
      "prompt": string,                         // can lightly contextualize the prompt for this deal
      "rationale": string                       // why this question now
    }
  ],
  "covered": [
    {
      "question_id": string,
      "covered_by": "ingestion" | "research" | "prior_answer",
      "evidence": string                        // short cite of what already answered it
    }
  ]
}

Order the batch by category order found in the candidate list (background/track-record first; personality/character last). Never include the same question_id in both batch and covered. Do not invent question_ids.`

function summarizeIngestion(out: IngestionOutput | null): string {
  if (!out) return '(none)'
  const parts: string[] = []
  for (const doc of out.documents) {
    parts.push(`- ${doc.detected_type}: ${doc.summary}`)
  }
  if (out.gap_analysis.missing.length > 0) {
    parts.push(`Missing: ${out.gap_analysis.missing.map(m => m.expected_type ?? '?').join(', ')}`)
  }
  return parts.join('\n') || '(empty)'
}

function summarizeResearch(out: ResearchOutput | null): string {
  if (!out) return '(none)'
  const parts: string[] = []
  for (const f of out.findings.slice(0, 30)) {
    parts.push(`- [${f.verification_status}] ${f.topic}: ${f.evidence.slice(0, 240)}`)
  }
  for (const c of out.contradictions) {
    parts.push(`- [contradiction · ${c.severity}] ${c.topic}: ${c.description}`)
  }
  for (const f of out.founder_dossiers) {
    parts.push(`- [founder] ${f.founder_name} (${f.role}): ${f.background_summary.slice(0, 240)}`)
  }
  return parts.join('\n') || '(empty)'
}
