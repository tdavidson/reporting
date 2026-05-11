/**
 * Heuristic document classification — fast, conservative, low-confidence.
 *
 * Used on upload to give documents an initial detected_type before the agent's
 * Stage 1 ingestion runs (which produces the authoritative classification).
 *
 * Output type names mirror data_room_ingestion.yaml document_types.
 */

export type DocumentType =
  | 'pitch_deck'
  | 'financial_model'
  | 'cap_table'
  | 'data_room_summary'
  | 'memo'
  | 'product_overview'
  | 'customer_references'
  | 'legal'
  | 'market_research'
  | 'team_bio'
  | 'press'
  | 'other'

export type Confidence = 'low' | 'medium' | 'high'

export interface HeuristicResult {
  detected_type: DocumentType
  confidence: Confidence
}

const DECK_KEYWORDS = ['deck', 'pitch', 'presentation', 'slides', 'pitchdeck']
const MODEL_KEYWORDS = ['model', 'financials', 'projections', 'forecast', 'p&l', 'pnl', 'budget']
const CAP_TABLE_KEYWORDS = ['cap table', 'cap_table', 'captable', 'ownership', 'waterfall']
const MEMO_KEYWORDS = ['memo', 'investment memo', 'board memo']
const LEGAL_KEYWORDS = ['saf', 'safe', 'note', 'term sheet', 'termsheet', 'shareholder', 'incorporation', 'articles', 'bylaws']
const MARKET_KEYWORDS = ['market', 'tam', 'industry', 'analyst report', 'gartner']
const TEAM_KEYWORDS = ['bio', 'biography', 'resume', 'cv', 'team', 'founder']
const PRESS_KEYWORDS = ['press', 'announcement', 'launch', 'feature', 'article']
const PRODUCT_KEYWORDS = ['product', 'overview', 'spec', 'roadmap']
const REFERENCES_KEYWORDS = ['reference', 'testimonial', 'case study', 'casestudy']

function hasKeyword(name: string, words: string[]): boolean {
  const lower = name.toLowerCase()
  return words.some(w => lower.includes(w))
}

function ext(filename: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

export function classifyDocumentHeuristic(filename: string, contentType?: string): HeuristicResult {
  const lower = filename.toLowerCase()
  const e = ext(filename)

  // Excel / sheets — almost always financial model or cap table.
  if (e === 'xlsx' || e === 'xls' || e === 'csv' || contentType?.includes('spreadsheetml')) {
    if (hasKeyword(lower, CAP_TABLE_KEYWORDS)) return { detected_type: 'cap_table', confidence: 'medium' }
    return { detected_type: 'financial_model', confidence: 'medium' }
  }

  // PowerPoint / Keynote — almost always a deck.
  if (e === 'pptx' || e === 'ppt' || e === 'key' || contentType?.includes('presentationml')) {
    return { detected_type: 'pitch_deck', confidence: 'medium' }
  }

  // PDF / DOCX — go by filename keywords.
  if (e === 'pdf' || e === 'docx' || e === 'doc' || e === 'md' || e === 'txt') {
    if (hasKeyword(lower, DECK_KEYWORDS)) return { detected_type: 'pitch_deck', confidence: 'medium' }
    if (hasKeyword(lower, CAP_TABLE_KEYWORDS)) return { detected_type: 'cap_table', confidence: 'low' }
    if (hasKeyword(lower, MODEL_KEYWORDS)) return { detected_type: 'financial_model', confidence: 'low' }
    if (hasKeyword(lower, MEMO_KEYWORDS)) return { detected_type: 'memo', confidence: 'medium' }
    if (hasKeyword(lower, LEGAL_KEYWORDS)) return { detected_type: 'legal', confidence: 'low' }
    if (hasKeyword(lower, REFERENCES_KEYWORDS)) return { detected_type: 'customer_references', confidence: 'low' }
    if (hasKeyword(lower, TEAM_KEYWORDS)) return { detected_type: 'team_bio', confidence: 'low' }
    if (hasKeyword(lower, PRESS_KEYWORDS)) return { detected_type: 'press', confidence: 'low' }
    if (hasKeyword(lower, MARKET_KEYWORDS)) return { detected_type: 'market_research', confidence: 'low' }
    if (hasKeyword(lower, PRODUCT_KEYWORDS)) return { detected_type: 'product_overview', confidence: 'low' }
    return { detected_type: 'other', confidence: 'low' }
  }

  // Images / video — probably a screenshot or demo recording.
  return { detected_type: 'other', confidence: 'low' }
}
