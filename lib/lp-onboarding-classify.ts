// Sorting a batch of onboarding documents without sending any of them anywhere.
//
// Onboarding documents are formulaic: a W-9 says "Form W-9" in its first lines, a subscription
// agreement says "Subscription Agreement" and names the subscriber, a signature page says
// "IN WITNESS WHEREOF". So the kind is a rules question, and the entity is a fuzzy-match question
// against names the fund already has. Both run here, on text the server extracted itself, and
// nothing in this file makes a network call or keeps the text. The output is a proposal for a
// person to confirm — a low-confidence guess is left blank rather than filed.

import { ONBOARDING_KINDS, type OnboardingKind } from './lp-onboarding'
import type { TaxFormType } from './tax/forms'

export type Confidence = 'high' | 'medium' | 'low'

export interface KindGuess {
  kind: OnboardingKind | null
  confidence: Confidence | null
  /** The phrases that decided it, so the reviewer can see why. */
  matchedOn: string[]
  /** For a tax form: which one. */
  taxFormType: TaxFormType | null
}

interface Rule {
  kind: OnboardingKind
  /** Strong evidence: a title or a form number. */
  strong: RegExp[]
  /** Supporting evidence: phrases typical of the document. */
  weak: RegExp[]
  /** Filename hints, lowercase substrings. */
  file: string[]
}

const RULES: Rule[] = [
  {
    kind: 'tax_form',
    strong: [/\bform\s*w-?\s?9\b/i, /request for taxpayer identification number/i, /\bw-?\s?8\s?ben-?e\b/i, /\bw-?\s?8\s?ben\b/i, /\bw-?\s?8\s?imy\b/i, /\bw-?\s?8\s?eci\b/i, /certificate of (?:foreign )?status of beneficial owner/i],
    weak: [/taxpayer identification/i, /backup withholding/i, /chapter 3 status/i, /fatca/i, /treaty benefits/i],
    file: ['w9', 'w-9', 'w8', 'w-8', 'tax form', 'taxform'],
  },
  {
    kind: 'subscription_agreement',
    strong: [/subscription agreement/i, /subscription booklet/i, /subscription documents?/i],
    weak: [/\bsubscriber\b/i, /capital commitment/i, /subscription amount/i, /hereby subscribes?/i, /limited partner(?:ship)? interests?/i],
    file: ['sub doc', 'subdoc', 'subscription', 'sub agreement', 'sub-agreement'],
  },
  {
    kind: 'lpa_signature',
    strong: [/counterpart signature page/i, /signature page to the (?:amended and restated )?(?:limited partnership|partnership) agreement/i, /(?:amended and restated )?agreement of limited partnership/i, /limited partnership agreement/i],
    weak: [/in witness whereof/i, /general partner/i, /executed as a deed/i, /power of attorney/i],
    file: ['lpa', 'signature page', 'sig page', 'partnership agreement'],
  },
  {
    kind: 'accreditation',
    strong: [/accredited investor (?:questionnaire|certification|status)/i, /qualified purchaser (?:questionnaire|certification|status)/i, /investor questionnaire/i, /verification of accredited investor status/i],
    weak: [/accredited investor/i, /qualified purchaser/i, /qualified client/i, /rule 501/i, /regulation d/i, /section 2\(a\)\(51\)/i, /net worth/i],
    file: ['accredit', 'questionnaire', 'qp letter', 'qualified purchaser', 'verification letter'],
  },
  {
    kind: 'beneficial_ownership',
    strong: [/beneficial ownership certification/i, /certification (?:regarding|of) beneficial owners?/i, /31 cfr 1010\.230/i],
    weak: [/beneficial owner/i, /fincen/i, /25% or more/i, /controlling person/i, /legal entity customer/i],
    file: ['beneficial', 'bo cert', 'ubo'],
  },
  {
    kind: 'kyc_entity',
    strong: [/certificate of formation/i, /articles of (?:incorporation|organization|association)/i, /certificate of incorporation/i, /certificate of (?:good standing|status|existence)/i, /certificate of incumbency/i, /operating agreement/i, /trust agreement/i, /declaration of trust/i, /\bbylaws\b/i, /certificate of trust/i],
    weak: [/secretary of state/i, /registered agent/i, /\btrustee\b/i, /\bmember(?:s)?\b/i, /authorized signator/i],
    file: ['formation', 'articles', 'incorporation', 'good standing', 'incumbency', 'operating agreement', 'trust agreement', 'bylaws'],
  },
  {
    kind: 'kyc_identity',
    strong: [/\bpassport\b/i, /driver'?s? licen[cs]e/i, /identification card/i, /identity card/i],
    weak: [/date of birth/i, /\bdob\b/i, /date of expir/i, /nationality/i, /place of birth/i, /\bsex\b/i, /\bheight\b/i],
    file: ['passport', 'license', 'licence', 'id card', 'photo id', 'drivers'],
  },
  {
    kind: 'wire_instructions',
    strong: [/wir(?:e|ing) instructions/i, /bank (?:account )?instructions/i, /payment instructions/i, /distribution instructions/i],
    weak: [/\baba\b/i, /routing (?:number|no)/i, /\bswift\b/i, /\biban\b/i, /account (?:number|no)/i, /beneficiary bank/i, /for further credit/i],
    file: ['wire', 'wiring', 'bank instructions', 'payment instructions'],
  },
  {
    kind: 'side_letter',
    strong: [/side letter/i, /side agreement/i, /most favou?red nations?/i],
    weak: [/\bmfn\b/i, /notwithstanding anything to the contrary in the (?:partnership )?agreement/i],
    file: ['side letter', 'sideletter', 'mfn'],
  },
]

/** Whitespace-collapsed, first ~40k characters — a title page and a signature block are all this needs. */
export function prepareText(raw: string): string {
  return raw.replace(/\u0000/g, ' ').replace(/[ \t]+/g, ' ').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').slice(0, 40_000)
}

export function classifyKind(text: string, fileName: string): KindGuess {
  const head = text.slice(0, 6_000)
  const lowerFile = fileName.toLowerCase()
  const scored = RULES.map(rule => {
    const matched: string[] = []
    let score = 0
    for (const re of rule.strong) {
      const m = head.match(re) ?? text.match(re)
      if (m) { matched.push(m[0]); score += head.match(re) ? 3 : 2 }
    }
    for (const re of rule.weak) {
      const m = text.match(re)
      if (m) { matched.push(m[0]); score += 1 }
    }
    for (const hint of rule.file) if (lowerFile.includes(hint)) { matched.push(`file name "${hint}"`); score += 2 }
    return { kind: rule.kind, score, matched }
  }).sort((a, b) => b.score - a.score)

  const best = scored[0]
  const second = scored[1]
  if (!best || best.score === 0) return { kind: null, confidence: null, matchedOn: [], taxFormType: null }

  // A signature page carries the partnership agreement's title, and a sub doc mentions the LPA.
  // Strong evidence plus a clear margin over the runner-up is what makes a guess worth trusting.
  const margin = best.score - (second?.score ?? 0)
  const hasStrong = best.matched.some(m => !m.startsWith('file name'))
  const confidence: Confidence = best.score >= 4 && margin >= 2 && hasStrong ? 'high' : best.score >= 2 && margin >= 1 ? 'medium' : 'low'
  return {
    kind: confidence === 'low' ? null : best.kind,
    confidence,
    matchedOn: Array.from(new Set(best.matched)).slice(0, 6),
    taxFormType: best.kind === 'tax_form' ? detectTaxFormType(text) : null,
  }
}

export function detectTaxFormType(text: string): TaxFormType | null {
  const t = text.slice(0, 8_000)
  if (/\bw-?\s?8\s?ben-?e\b/i.test(t)) return 'w8bene'
  if (/\bw-?\s?8\s?imy\b/i.test(t)) return 'w8imy'
  if (/\bw-?\s?8\s?eci\b/i.test(t)) return 'w8eci'
  if (/\bw-?\s?8\s?ben\b/i.test(t)) return 'w8ben'
  if (/\bw-?\s?9\b/i.test(t) || /request for taxpayer identification number/i.test(t)) return 'w9'
  return null
}

// ---------------------------------------------------------------------------------------------
// Facts: what a reviewer wants to see next to the file.
// ---------------------------------------------------------------------------------------------

export interface DocumentFacts {
  /** Names found where a subscriber, investor or partner is asked to print theirs. */
  nameCandidates: string[]
  /** ISO dates found near "dated", "date", "executed", "signed". */
  dateCandidates: string[]
  /** A dollar amount found near "commitment" or "subscription amount". */
  statedCommitment: number | null
  /** For a tax form: the identification, deliberately partial — never the full number. */
  tin: { type: 'ssn' | 'ein' | 'itin' | null; last4: string } | null
  /** For a W-8: a country named as residence, citizenship or incorporation. */
  country: string | null
}

const NAME_LABELS = [
  /name of (?:the )?(?:subscriber|investor|partner|limited partner|purchaser|entity|organization|trust|individual who is the beneficial owner|beneficial owner)\s*[:\-]?\s*([^\n]{2,120})/gi,
  /(?:subscriber|investor|partner|purchaser)(?:'s)? (?:legal )?name\s*[:\-]?\s*([^\n]{2,120})/gi,
  /(?:print|printed|legal|entity|full) name\s*(?:of [a-z ]+)?\s*[:\-]?\s*([^\n]{2,120})/gi,
  /name \(as shown on your income tax return\)[^\n]*\n\s*([^\n]{2,120})/gi,
  /^\s*(?:subscriber|investor|limited partner)\s*:\s*([^\n]{2,120})$/gim,
  /\bby\s*:\s*_*\s*\n?\s*name\s*:\s*([^\n]{2,120})/gi,
]

const DATE_RE = /\b(?:(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})|((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})|(\d{1,2}(?:st|nd|rd|th)?\s+(?:day of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+\d{4})|(\d{4}-\d{2}-\d{2}))\b/gi

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }

function toIso(match: RegExpExecArray): string | null {
  const [, m, d, y, mdy, dmy, iso] = match
  const pad = (n: number) => String(n).padStart(2, '0')
  if (iso) return iso
  if (m && d && y) {
    const year = y.length === 2 ? 2000 + Number(y) : Number(y)
    const mm = Number(m), dd = Number(d)
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
    return `${year}-${pad(mm)}-${pad(dd)}`
  }
  const text = (mdy ?? dmy ?? '').toLowerCase()
  const mon = Object.keys(MONTHS).find(k => new RegExp(`\\b${k}`).test(text))
  const day = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/)
  const year = text.match(/\b(\d{4})\b/)
  if (!mon || !day || !year) return null
  return `${year[1]}-${pad(MONTHS[mon])}-${pad(Number(day[1]))}`
}

function cleanName(s: string): string | null {
  // Trailing commas and dashes are layout; a trailing period may be "Inc." or "L.P." and stays.
  const v = s.replace(/[_\s]+/g, ' ').replace(/^[\s:\-–—]+|[\s:\-–—,]+$/g, '').trim()
  if (v.length < 2 || v.length > 120) return null
  // A label that happened to be followed by another label, or a blank line of underscores.
  if (/^(?:name|date|title|signature|address|by|its|email|phone|city|state|zip)\b/i.test(v)) return null
  if (!/[a-z]/i.test(v)) return null
  return v
}

export function extractFacts(text: string, kind: OnboardingKind | null): DocumentFacts {
  const names = new Set<string>()
  for (const re of NAME_LABELS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null && names.size < 8) {
      const v = cleanName(m[1])
      if (v) names.add(v)
    }
  }

  const dates = new Set<string>()
  const dateContext = /(?:dated|date[d]?\s*(?:of|:)?|executed|signed|as of|effective)[^\n]{0,40}?/gi
  let dm: RegExpExecArray | null
  while ((dm = dateContext.exec(text)) !== null && dates.size < 6) {
    const window = text.slice(dm.index, dm.index + 80)
    DATE_RE.lastIndex = 0
    const d = DATE_RE.exec(window)
    if (d) { const iso = toIso(d); if (iso) dates.add(iso) }
  }

  let statedCommitment: number | null = null
  const amountContext = /(?:capital commitment|commitment amount|subscription amount|commitment|subscribes? for|aggregate commitment)[^\n$]{0,60}\$\s?([\d,]+(?:\.\d{2})?)/i
  const am = text.match(amountContext)
  if (am) { const n = Number(am[1].replace(/,/g, '')); if (Number.isFinite(n) && n > 0) statedCommitment = n }

  let tin: DocumentFacts['tin'] = null
  let country: string | null = null
  if (kind === 'tax_form') {
    // Last four only. The pattern is matched, the number is thrown away.
    const ssn = text.match(/\b(\d{3})[- ]?(\d{2})[- ]?(\d{4})\b/)
    const ein = text.match(/\b(\d{2})-(\d{7})\b/)
    if (ein) tin = { type: 'ein', last4: ein[2].slice(-4) }
    else if (ssn) tin = { type: ssn[1].startsWith('9') ? 'itin' : 'ssn', last4: ssn[3] }
    const c = text.match(/country of (?:citizenship|residence|incorporation|organization|organisation)\s*[:\-]?\s*([A-Za-z][A-Za-z .'-]{2,40})/i)
    if (c) country = c[1].trim().replace(/[.,]+$/, '')
  }

  return { nameCandidates: Array.from(names), dateCandidates: Array.from(dates), statedCommitment, tin, country }
}

// ---------------------------------------------------------------------------------------------
// Entity matching: fuzzy, local, explainable.
// ---------------------------------------------------------------------------------------------

export interface MatchableEntity {
  id: string
  name: string
  investorName: string
}

export interface EntityMatch {
  entityId: string | null
  confidence: Confidence | null
  /** What the match was made on — the candidate name, or "named in the document". */
  matchedOn: string | null
  /** The runner-up, when a reviewer should know it was close. */
  alternatives: { entityId: string; score: number }[]
}

const SUFFIXES = new Set(['lp', 'l.p', 'llc', 'l.l.c', 'llp', 'inc', 'ltd', 'limited', 'co', 'corp', 'corporation', 'company', 'the', 'plc', 'gmbh', 'sa', 'ag', 'nv', 'bv', 'sarl', 'pty', 'lc'])

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    // "L.P." and "L.L.C." are one token each, not three single letters.
    .replace(/\b(?:[a-z]\.){2,}/g, m => m.replace(/\./g, ''))
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(t => t && !SUFFIXES.has(t))
    .join(' ')
    .trim()
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>()
  const t = s.replace(/\s+/g, ' ')
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2)
    out.set(g, (out.get(g) ?? 0) + 1)
  }
  return out
}

/** Sørensen–Dice on character bigrams: 1 for identical strings, tolerant of small typos and reordering. */
export function similarity(a: string, b: string): number {
  const x = normalizeName(a), y = normalizeName(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const ga = bigrams(x), gb = bigrams(y)
  let overlap = 0
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0)
  const total = Array.from(ga.values()).reduce((s, n) => s + n, 0) + Array.from(gb.values()).reduce((s, n) => s + n, 0)
  return total === 0 ? 0 : (2 * overlap) / total
}

export function matchEntity(candidates: string[], fullText: string, entities: MatchableEntity[]): EntityMatch {
  if (entities.length === 0) return { entityId: null, confidence: null, matchedOn: null, alternatives: [] }
  const normText = normalizeName(fullText.slice(0, 40_000))

  const scores = entities.map(e => {
    let best = 0
    let on: string | null = null
    for (const c of candidates) {
      for (const target of [e.name, e.investorName]) {
        const s = similarity(c, target)
        if (s > best) { best = s; on = c }
      }
    }
    // The entity's own name appearing verbatim in the text is strong evidence on its own — a
    // signature page may have no label to find the name by.
    for (const target of [e.name, e.investorName]) {
      const n = normalizeName(target)
      if (n.length >= 6 && normText.includes(n)) {
        const s = 0.92
        if (s > best) { best = s; on = 'named in the document' }
      }
    }
    return { entityId: e.id, score: best, on }
  }).sort((a, b) => b.score - a.score)

  const top = scores[0]
  const runnerUp = scores[1]
  const margin = top.score - (runnerUp?.score ?? 0)
  const alternatives = scores.slice(1, 3).filter(s => s.score >= 0.6).map(({ entityId, score }) => ({ entityId, score: Math.round(score * 100) / 100 }))

  if (top.score >= 0.85 && margin >= 0.1) return { entityId: top.entityId, confidence: 'high', matchedOn: top.on, alternatives }
  if (top.score >= 0.7 && margin >= 0.05) return { entityId: top.entityId, confidence: 'medium', matchedOn: top.on, alternatives }
  return { entityId: null, confidence: top.score >= 0.5 ? 'low' : null, matchedOn: null, alternatives: scores.slice(0, 3).filter(s => s.score >= 0.5).map(({ entityId, score }) => ({ entityId, score: Math.round(score * 100) / 100 })) }
}

// ---------------------------------------------------------------------------------------------
// The whole proposal for one file.
// ---------------------------------------------------------------------------------------------

export interface SortProposal {
  kind: KindGuess
  entity: EntityMatch
  facts: DocumentFacts
  /** The commitment on file for the proposed entity, and whether the document disagrees. */
  commitmentOnFile: number | null
  commitmentMismatch: boolean
  /** Why nothing could be read, when that is the case. */
  unreadable: string | null
}

export function proposeSort(
  text: string,
  fileName: string,
  entities: MatchableEntity[],
  commitmentByEntity: Map<string, number>,
): SortProposal {
  const prepared = prepareText(text)
  if (prepared.replace(/\s+/g, '').length < 20) {
    return {
      kind: { kind: null, confidence: null, matchedOn: [], taxFormType: null },
      entity: { entityId: null, confidence: null, matchedOn: null, alternatives: [] },
      facts: { nameCandidates: [], dateCandidates: [], statedCommitment: null, tin: null, country: null },
      commitmentOnFile: null, commitmentMismatch: false,
      unreadable: 'No readable text — a scan or photo the OCR could not read. Sort it by hand.',
    }
  }
  const kind = classifyKind(prepared, fileName)
  const facts = extractFacts(prepared, kind.kind)
  // The file name often carries the investor's name too.
  const fileStem = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_\-.]+/g, ' ')
  const entity = matchEntity([...facts.nameCandidates, fileStem], prepared, entities)
  const onFile = entity.entityId ? (commitmentByEntity.get(entity.entityId) ?? null) : null
  const mismatch = onFile !== null && facts.statedCommitment !== null && Math.abs(onFile - facts.statedCommitment) > 0.5
  return { kind, entity, facts, commitmentOnFile: onFile, commitmentMismatch: mismatch, unreadable: null }
}

export const SORTABLE_KINDS: readonly OnboardingKind[] = ONBOARDING_KINDS
