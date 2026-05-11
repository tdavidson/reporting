import yaml from 'js-yaml'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveSchema } from './firm-schemas'

type Admin = ReturnType<typeof createAdminClient>

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VoiceRepresentativeness = 'exemplary' | 'representative' | 'atypical' | 'do_not_match_voice'
export type Outcome = 'invested' | 'passed' | 'lost_competitive' | 'withdrew' | 'unknown'
export type Conviction = 'high' | 'medium' | 'low' | 'mixed'
export type WeightingScheme = 'equal' | 'recency_weighted' | 'conviction_weighted' | 'partner_marked'
export type SynthesisConfidence = 'unavailable' | 'preliminary' | 'reliable' | 'robust'

export interface StyleAnchor {
  id: string
  fund_id: string
  storage_path: string
  file_name: string
  file_format: string
  file_size_bytes: number | null
  title: string | null
  anonymized: boolean
  vintage_year: number | null
  vintage_quarter: string | null
  sector: string | null
  deal_stage_at_writing: string | null
  outcome: Outcome | null
  conviction_at_writing: Conviction | null
  voice_representativeness: VoiceRepresentativeness
  authorship: string | null
  author_initials: string | null
  focus_attention_on: string[] | null
  deprioritize_in_this_memo: string[] | null
  partner_notes: string | null
  extracted_text: string | null
  extracted_at: string | null
  uploaded_at: string
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Returns all style anchors for a fund, including their cached extracted_text.
 */
export async function getActiveAnchors(fundId: string, admin?: Admin): Promise<StyleAnchor[]> {
  const client = admin ?? createAdminClient()
  const { data, error } = await client
    .from('style_anchor_memos')
    .select('id, fund_id, storage_path, file_name, file_format, file_size_bytes, title, anonymized, vintage_year, vintage_quarter, sector, deal_stage_at_writing, outcome, conviction_at_writing, voice_representativeness, authorship, author_initials, focus_attention_on, deprioritize_in_this_memo, partner_notes, extracted_text, extracted_at, uploaded_at')
    .eq('fund_id', fundId)
    .order('vintage_year', { ascending: false })
    .order('uploaded_at', { ascending: false })

  if (error) {
    console.error('[style-anchors] getActiveAnchors error:', error)
    return []
  }
  return (data ?? []) as StyleAnchor[]
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

/**
 * Per style_anchors.yaml `aggregation.minimum_useful_count`:
 *   0          → unavailable (no voice signal at all)
 *   1-2        → preliminary
 *   3-7        → reliable
 *   8+         → robust
 */
export function getSynthesisConfidence(anchorCount: number): SynthesisConfidence {
  if (anchorCount <= 0) return 'unavailable'
  if (anchorCount <= 2) return 'preliminary'
  if (anchorCount <= 7) return 'reliable'
  return 'robust'
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

const MAX_PROMPT_CHARS_PER_ANCHOR = 8000
const MAX_TOTAL_PROMPT_CHARS = 60_000

/**
 * Build the system-prompt fragment that injects the firm's voice into a memo
 * run. Called by Stage 4 (drafting) and any preview surface.
 *
 * The block:
 *   1. Filters to anchors that should inform voice (per the active weighting).
 *   2. Orders / weights them per the chosen scheme.
 *   3. Caps content to a budget so the prompt doesn't explode on funds with
 *      40+ anchors.
 *   4. Includes per-anchor metadata partners can use to interpret the agent
 *      output.
 *
 * Uses the fund's active style_anchors schema (when present) to pick a
 * weighting scheme; falls back to `equal` per the schema default.
 */
export async function buildVoiceSynthesisBlock(fundId: string, admin?: Admin): Promise<{
  block: string
  confidence: SynthesisConfidence
  weighting: WeightingScheme
  anchor_count: number
  considered_count: number
}> {
  const client = admin ?? createAdminClient()
  const anchors = await getActiveAnchors(fundId, client)
  const confidence = getSynthesisConfidence(anchors.length)

  if (anchors.length === 0) {
    return {
      block: '',
      confidence,
      weighting: 'equal',
      anchor_count: 0,
      considered_count: 0,
    }
  }

  const weighting = await pickWeighting(fundId, client)
  const filtered = filterForVoice(anchors, weighting)
  const ordered = orderForWeighting(filtered, weighting)

  // Build the prompt block, keeping under a total character budget.
  let total = 0
  const blocks: string[] = []
  for (const a of ordered) {
    const piece = renderAnchor(a)
    if (total + piece.length > MAX_TOTAL_PROMPT_CHARS) break
    blocks.push(piece)
    total += piece.length
  }

  const header = renderHeader(weighting, confidence, anchors.length, blocks.length)
  return {
    block: header + '\n\n' + blocks.join('\n\n---\n\n'),
    confidence,
    weighting,
    anchor_count: anchors.length,
    considered_count: blocks.length,
  }
}

// ---------------------------------------------------------------------------
// Helpers — weighting / filtering / ordering
// ---------------------------------------------------------------------------

async function pickWeighting(fundId: string, admin: Admin): Promise<WeightingScheme> {
  const schema = await getActiveSchema(fundId, 'style_anchors', admin)
  if (!schema?.parsed_content) return 'equal'
  const parsed = schema.parsed_content as any
  const def = parsed?.aggregation?.default_weighting
  if (typeof def === 'string' && ['equal', 'recency_weighted', 'conviction_weighted', 'partner_marked'].includes(def)) {
    return def as WeightingScheme
  }
  return 'equal'
}

function filterForVoice(anchors: StyleAnchor[], weighting: WeightingScheme): StyleAnchor[] {
  // `do_not_match_voice` anchors are always read for structure but skipped
  // for voice — they don't enter the synthesis block.
  let out = anchors.filter(a => a.voice_representativeness !== 'do_not_match_voice')

  if (weighting === 'partner_marked') {
    out = out.filter(a => a.voice_representativeness === 'exemplary' || a.voice_representativeness === 'representative')
  }

  // Skip anchors that haven't been extracted yet — without text we have
  // nothing to teach voice from.
  out = out.filter(a => a.extracted_text && a.extracted_text.trim().length > 0)

  return out
}

function orderForWeighting(anchors: StyleAnchor[], weighting: WeightingScheme): StyleAnchor[] {
  const sorted = [...anchors]
  if (weighting === 'recency_weighted') {
    sorted.sort((a, b) => (b.vintage_year ?? 0) - (a.vintage_year ?? 0))
  } else if (weighting === 'conviction_weighted') {
    const rank = (c: Conviction | null) => c === 'high' ? 3 : c === 'mixed' ? 2 : c === 'medium' ? 1 : 0
    sorted.sort((a, b) => rank(b.conviction_at_writing) - rank(a.conviction_at_writing))
  } else if (weighting === 'partner_marked') {
    const rank = (v: VoiceRepresentativeness) => v === 'exemplary' ? 2 : v === 'representative' ? 1 : 0
    sorted.sort((a, b) => rank(b.voice_representativeness) - rank(a.voice_representativeness))
  }
  // equal: keep getActiveAnchors order (vintage then upload date)
  return sorted
}

function renderHeader(weighting: WeightingScheme, confidence: SynthesisConfidence, total: number, considered: number): string {
  const lines: string[] = [
    '=== FIRM VOICE — REFERENCE MEMOS ===',
    `Weighting: ${weighting}. Synthesis confidence: ${confidence}. ${considered} of ${total} anchors included in this prompt.`,
    '',
    'These memos teach voice, structure, and analytical patterns — never facts.',
    'When reference memos disagree, follow the dominant cluster (>60%); flag divergences in agent_notes.',
    'Outdated surface vocabulary is updated; structural patterns are preserved.',
  ]
  return lines.join('\n')
}

function renderAnchor(a: StyleAnchor): string {
  const meta: string[] = []
  if (a.title) meta.push(`Title: ${a.title}`)
  if (a.vintage_year) meta.push(`Vintage: ${a.vintage_year}${a.vintage_quarter ? ` ${a.vintage_quarter}` : ''}`)
  if (a.sector) meta.push(`Sector: ${a.sector}`)
  if (a.deal_stage_at_writing) meta.push(`Stage: ${a.deal_stage_at_writing}`)
  if (a.outcome) meta.push(`Outcome: ${a.outcome}`)
  if (a.conviction_at_writing) meta.push(`Conviction: ${a.conviction_at_writing}`)
  if (a.voice_representativeness) meta.push(`Voice: ${a.voice_representativeness}`)
  if (a.authorship) meta.push(`Authorship: ${a.authorship}`)

  const focus = (a.focus_attention_on ?? []).filter(Boolean)
  const deprioritize = (a.deprioritize_in_this_memo ?? []).filter(Boolean)

  const parts: string[] = [`-- Anchor: ${a.id} --`, meta.join(' · ')]
  if (focus.length) parts.push(`Focus on: ${focus.join(', ')}`)
  if (deprioritize.length) parts.push(`Deprioritize: ${deprioritize.join(', ')}`)
  if (a.partner_notes?.trim()) parts.push(`Partner notes: ${a.partner_notes.trim()}`)

  const text = (a.extracted_text ?? '').slice(0, MAX_PROMPT_CHARS_PER_ANCHOR)
  parts.push(`Memo text:\n${text}${(a.extracted_text?.length ?? 0) > MAX_PROMPT_CHARS_PER_ANCHOR ? '\n[...truncated]' : ''}`)

  return parts.join('\n\n')
}

// ---------------------------------------------------------------------------
// Re-export yaml so tests can build sample anchors without a separate import
// (kept here so the whole style-anchors surface is one file).
// ---------------------------------------------------------------------------
export const _yaml = yaml
