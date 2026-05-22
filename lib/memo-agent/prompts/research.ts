import type { ContentBlock } from '@/lib/ai/types'
import type { IngestionOutput } from '@/lib/memo-agent/stages/ingest'

export interface ResearchPromptInput {
  dealName: string
  ingestion: IngestionOutput
  /** Whether the AI provider has external web search wired up. */
  webSearchEnabled: boolean
}

// ---------------------------------------------------------------------------
// Sub-prompt 1: claims (findings + contradictions + research_gaps)
// ---------------------------------------------------------------------------

export function buildResearchClaimsContent(input: ResearchPromptInput): ContentBlock[] {
  const summary = summarizeClaims(input.ingestion)
  const text = [
    `Deal: ${input.dealName}`,
    '',
    `=== STAGE 1 INGESTION OUTPUT (claims to verify, gaps to fill) ===`,
    summary,
    '',
    input.webSearchEnabled ? CLAIMS_INSTRUCTIONS_WITH_WEB : CLAIMS_INSTRUCTIONS_NO_WEB,
  ].join('\n')
  return [{ type: 'text', text }]
}

// ---------------------------------------------------------------------------
// Sub-prompt 2: competitive_map
// ---------------------------------------------------------------------------

export function buildResearchCompetitorsContent(input: ResearchPromptInput): ContentBlock[] {
  const summary = summarizeForCompetitors(input.ingestion)
  const text = [
    `Deal: ${input.dealName}`,
    '',
    `=== STAGE 1 INGESTION (competitor mentions + product context) ===`,
    summary,
    '',
    input.webSearchEnabled ? COMPETITORS_INSTRUCTIONS_WITH_WEB : COMPETITORS_INSTRUCTIONS_NO_WEB,
  ].join('\n')
  return [{ type: 'text', text }]
}

// ---------------------------------------------------------------------------
// Sub-prompt 3: founder_dossiers
// ---------------------------------------------------------------------------

export function buildResearchFoundersContent(input: ResearchPromptInput): ContentBlock[] {
  const summary = summarizeForFounders(input.ingestion)
  const text = [
    `Deal: ${input.dealName}`,
    '',
    `=== STAGE 1 INGESTION (team / founder context) ===`,
    summary,
    '',
    input.webSearchEnabled ? FOUNDERS_INSTRUCTIONS_WITH_WEB : FOUNDERS_INSTRUCTIONS_NO_WEB,
  ].join('\n')
  return [{ type: 'text', text }]
}

// ---------------------------------------------------------------------------
// Summarizers — keep each sub-call's input focused so we don't reship the
// whole data room to every call.
// ---------------------------------------------------------------------------

function summarizeClaims(out: IngestionOutput): string {
  const parts: string[] = []
  for (const doc of out.documents) {
    parts.push(`# Document: ${doc.document_id} (${doc.detected_type})`)
    if (doc.summary) parts.push(doc.summary)
    if (doc.claims.length > 0) {
      parts.push(`Claims (${doc.claims.length}):`)
      for (const c of doc.claims) {
        parts.push(`  • [${c.criticality}] id=${c.id} | ${c.field} = ${c.value}${c.context ? ` (${c.context})` : ''}`)
      }
    }
  }
  const activeMissing = out.gap_analysis.missing.filter(g => !g.dismissed)
  if (activeMissing.length > 0) {
    parts.push(`# Missing documents`)
    for (const g of activeMissing) parts.push(`  • [${g.criticality}] ${g.expected_type ?? 'unknown'}: ${g.rationale}`)
  }
  if (out.cross_doc_flags.length > 0) {
    parts.push(`# Cross-doc inconsistencies`)
    for (const f of out.cross_doc_flags) parts.push(`  • ${f.description} (docs: ${f.doc_ids.join(', ')})`)
  }
  return parts.join('\n')
}

function summarizeForCompetitors(out: IngestionOutput): string {
  const parts: string[] = []
  // Product / market overview from pitch_deck and similar docs.
  for (const doc of out.documents) {
    if (['pitch_deck', 'product_overview', 'market_research'].includes(doc.detected_type)) {
      parts.push(`# ${doc.detected_type}: ${doc.document_id}`)
      if (doc.summary) parts.push(doc.summary)
    }
  }
  // Any claim that smells like a competitor mention.
  const competitorClaims = out.documents.flatMap(d =>
    d.claims.filter(c => /competit|market|landscape|alternative|incumbent/i.test(c.field + ' ' + c.context + ' ' + c.value))
  )
  if (competitorClaims.length > 0) {
    parts.push('# Competitor-related claims')
    for (const c of competitorClaims) {
      parts.push(`  • ${c.field}: ${c.value} (${c.context})`)
    }
  }
  if (parts.length === 0) parts.push('(No explicit competitor mentions in ingestion. Identify competitors based on product/market positioning if web search is enabled.)')
  return parts.join('\n')
}

function summarizeForFounders(out: IngestionOutput): string {
  const parts: string[] = []
  for (const doc of out.documents) {
    if (['team_bio', 'pitch_deck'].includes(doc.detected_type)) {
      parts.push(`# ${doc.detected_type}: ${doc.document_id}`)
      if (doc.summary) parts.push(doc.summary)
      const teamClaims = doc.claims.filter(c => /founder|ceo|cto|cmo|cfo|team|background|role|experience/i.test(c.field + ' ' + c.context))
      if (teamClaims.length > 0) {
        parts.push('Team claims:')
        for (const c of teamClaims) parts.push(`  • ${c.field}: ${c.value} (${c.context})`)
      }
    }
  }
  if (parts.length === 0) parts.push('(No team_bio or pitch_deck found in ingestion. Surface as a research_gap rather than fabricating founder names.)')
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Instructions — keep small and focused. Each sub-call only asks for its own
// piece of research_dossier.yaml's output shape.
// ---------------------------------------------------------------------------

const CLAIMS_COMMON = `STAGE 2 — CLAIMS VERIFICATION

Verify or contradict company-stated claims, surface inconsistencies, and identify gaps where the data room is silent on important questions.

Hard rules:
  - No LinkedIn scraping, even via third-party APIs.
  - Name every source when you cite a fact. No "industry sources say…".
  - Distinguish company-stated (verification_status: company_stated), independently-verified (verification_status: verified), contradicted (verification_status: contradicted), and inconclusive.

Return JSON ONLY:
{
  "findings": [
    {
      "id": string,
      "claim_ref": string|null,
      "topic": string,
      "verification_status": "verified" | "contradicted" | "company_stated" | "inconclusive",
      "evidence": string,
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
  "research_gaps": [
    {"topic": string, "rationale": string, "criticality": "blocker" | "important" | "nice_to_have"}
  ]
}

Do not fabricate URLs. When you cannot verify externally, list the topic as a research_gap.`

const CLAIMS_INSTRUCTIONS_WITH_WEB = `${CLAIMS_COMMON}

Web search is available — use it to verify material claims.`

const CLAIMS_INSTRUCTIONS_NO_WEB = `${CLAIMS_COMMON}

Web search is NOT available. You may use your training-time knowledge only — and only when you can name a specific source. For everything else, list as a research_gap.`

const COMPETITORS_COMMON = `STAGE 2 — COMPETITIVE MAP

Build a competitive map. Two buckets:
  - named_by_company: competitors the company itself mentions in the ingestion. Quote them faithfully.
  - named_by_research: competitors you identify from product/market positioning that the company did not name.

Return JSON ONLY:
{
  "competitive_map": {
    "named_by_company": [{"name": string, "note": string}],
    "named_by_research": [{"name": string, "rationale": string, "sources": [{"title": string, "url": string|null}]}]
  }
}

Do not fabricate URLs. If you cannot identify additional competitors with confidence, return an empty named_by_research array.`

const COMPETITORS_INSTRUCTIONS_WITH_WEB = `${COMPETITORS_COMMON}

Web search is available — use it to identify competitors the company didn't name.`

const COMPETITORS_INSTRUCTIONS_NO_WEB = `${COMPETITORS_COMMON}

Web search is NOT available. Use training-time knowledge sparingly for named_by_research — only when you can cite a specific source.`

const FOUNDERS_COMMON = `STAGE 2 — FOUNDER DOSSIERS

For each founder named in the ingestion (do not invent founders), produce a dossier of their professional background. Surface open questions a partner should ask.

Hard rules:
  - No LinkedIn scraping. Use only sources you can name.
  - background_summary should be 2-4 sentences focused on relevant experience, not biography.

Return JSON ONLY:
{
  "founder_dossiers": [
    {
      "founder_name": string,
      "role": string,
      "background_summary": string,
      "sources": [{"title": string, "url": string|null}],
      "open_questions": [string]
    }
  ]
}`

const FOUNDERS_INSTRUCTIONS_WITH_WEB = `${FOUNDERS_COMMON}

Web search is available — use it (without LinkedIn) to corroborate roles and prior companies.`

const FOUNDERS_INSTRUCTIONS_NO_WEB = `${FOUNDERS_COMMON}

Web search is NOT available. If you cannot find non-LinkedIn sources for a founder, leave sources empty and add a research_gap-style question to open_questions.`
