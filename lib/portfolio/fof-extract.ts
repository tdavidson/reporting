import { normalizeDate, parseAmount } from '@/lib/accounting/bank'
import type { GridInputRow } from './fof-paste'

/**
 * Turning a manager's quarterly PDF into the SAME reviewable rows the paste grid produces.
 *
 * This module is the contract and the validator — no AI import, no Supabase — so what the
 * model is asked for and what is accepted back can both be tested without a model.
 *
 * NEVER TRUST A MODEL NUMBER. Everything that comes back is re-parsed here: amounts must be
 * finite and non-negative, dates are normalized through the same helper the paste path uses,
 * and anything that fails is DROPPED with a warning naming the fund. A wrong figure that looks
 * tidy is worse than a missing one, because the missing one gets typed and the wrong one gets
 * confirmed.
 */

export interface ExtractedRow extends GridInputRow {
  /** The model's own assessment. Absent or unrecognized becomes 'low'. */
  confidence: 'high' | 'medium' | 'low'
  /** The text this row was read from, so a human reviews against the statement. */
  sourceText: string | null
}

/** The JSON Schema the model fills in. */
export const EXTRACTION_SCHEMA = {
  type: 'object',
  required: ['rows'],
  properties: {
    rows: {
      type: 'array',
      description: 'One entry per underlying fund the document reports on. Usually exactly one.',
      items: {
        type: 'object',
        required: ['fundName'],
        properties: {
          fundName: { type: 'string', description: 'The underlying fund, exactly as printed.' },
          navAsOf: { type: 'string', description: "The manager's valuation date (YYYY-MM-DD). NOT the date the document was sent. Omit if absent." },
          reportedNav: { type: 'number', description: 'Our ending capital account / NAV. Omit if the document does not state one.' },
          calls: { type: 'number', description: 'Capital CALLED from us in this period. 0 if none. Always positive.' },
          distributions: { type: 'number', description: 'Capital DISTRIBUTED to us in this period. 0 if none. Always positive.' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          sourceText: { type: 'string', description: 'The line you read the figures from, verbatim.' },
        },
      },
    },
  },
} as const

/**
 * The instruction. States the accounting framing explicitly because the naive reading of a
 * capital call notice — "management fee is an expense" — produces the wrong cost basis.
 */
export const EXTRACTION_PROMPT = `You are reading a private fund document sent to a limited partner: a capital account statement, a capital call notice, or a distribution notice.

Extract, for each underlying fund the document reports on:
- the fund's name exactly as printed
- the manager's VALUATION date (the "as of" date of the NAV) — not the date the letter was sent
- our ending capital account balance / NAV, if stated
- capital CALLED from us in this period, as a positive number (0 if none)
- capital DISTRIBUTED to us in this period, as a positive number (0 if none)

Rules:
- Report amounts as plain numbers, always POSITIVE. Direction is conveyed by which field you put them in, never by a sign.
- A capital call is reported in full even when part of it funds the manager's management fee or partnership expenses — the whole call is the investor's cost basis.
- If a figure is not stated, omit the field. Do NOT infer, compute, or carry a figure over from another period.
- If you are unsure of a figure, still report it but set confidence to "low".
- Quote the line you read the figures from in sourceText.
- If the document is not a fund statement or notice, return an empty rows array.`

const TOTAL_ROW = /^(total|totals|grand total|sum)$/i

/**
 * Coerce whatever came back into rows we are willing to show a human. Never throws: a model
 * returning prose instead of JSON is an ordinary outcome, not an exception.
 */
export function validateExtraction(raw: unknown): { rows: ExtractedRow[]; warnings: string[] } {
  const warnings: string[] = []

  if (!raw || typeof raw !== 'object') {
    return { rows: [], warnings: ['The extractor did not return a result that could be read.'] }
  }
  const list = (raw as any).rows
  if (!Array.isArray(list)) {
    return { rows: [], warnings: ['The extractor returned no rows.'] }
  }

  const rows: ExtractedRow[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') { warnings.push('Skipped an unreadable row.'); continue }

    const fundName = typeof item.fundName === 'string' ? item.fundName.trim() : ''
    if (!fundName) { warnings.push('Skipped a row with no fund name.'); continue }
    if (TOTAL_ROW.test(fundName)) continue

    // Amounts. An absent cash figure means "nothing this period"; an absent NAV means the
    // manager did not state one, which is NOT the same as zero.
    const money = (v: unknown, label: string): number | null | undefined => {
      if (v === null || v === undefined || v === '') return null
      const n = typeof v === 'number' ? v : parseAmount(String(v))
      if (n === null || !Number.isFinite(n)) {
        warnings.push(`${fundName}: could not read ${label} ("${String(v)}").`)
        return undefined
      }
      if (n < 0) {
        // A negative call is a misread, not a distribution. Direction comes from the field.
        warnings.push(`${fundName}: ${label} came back negative (${n}); amounts must be positive.`)
        return undefined
      }
      return n
    }

    const nav = money(item.reportedNav, 'the reported NAV')
    const calls = money(item.calls, 'calls')
    const dists = money(item.distributions, 'distributions')
    if (nav === undefined || calls === undefined || dists === undefined) continue

    let navAsOf: string | null = null
    if (item.navAsOf !== null && item.navAsOf !== undefined && String(item.navAsOf).trim() !== '') {
      navAsOf = normalizeDate(String(item.navAsOf))
      if (!navAsOf) {
        warnings.push(`${fundName}: could not read the valuation date ("${String(item.navAsOf)}").`)
        continue
      }
    }

    const confidence = item.confidence === 'high' || item.confidence === 'medium' ? item.confidence : 'low'

    rows.push({
      fundName,
      navAsOf,
      reportedNav: nav,
      // A blank cash column means nothing happened this period.
      calls: calls ?? 0,
      distributions: dists ?? 0,
      confidence,
      sourceText: typeof item.sourceText === 'string' ? item.sourceText : null,
    })
  }

  return { rows, warnings }
}
