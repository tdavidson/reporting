// The source types a journal entry can carry. Shared by the AI paths that have to
// pick one (the assistant when drafting from a document, the bank categorizer) so
// they can't drift apart.

export const ENTRY_SOURCE_TYPES = [
  'capital_call',
  'distribution',
  'management_fee',
  'partnership_expense',
  'organizational_expense',
  'realized_gain',
  'income',
  'valuation',
  // The rate moved, not the company. Kept apart from `valuation` so the close allocates
  // it as its own line and it never masquerades as investment performance.
  'fx_revaluation',
  'opening_balance',
  'manual',
]

export type EntrySourceType = (typeof ENTRY_SOURCE_TYPES)[number]

export function isEntrySourceType(v: unknown): v is EntrySourceType {
  return typeof v === 'string' && (ENTRY_SOURCE_TYPES as readonly string[]).includes(v)
}

/**
 * Labels for a picker. The source type is what buckets an entry on the capital roll-forward
 * (close.ts), so a person booking a fee by hand needs to be able to say so — otherwise it lands
 * under "Other" on every partner's statement.
 */
export const ENTRY_SOURCE_TYPE_LABELS: Record<EntrySourceType, string> = {
  manual: 'General entry',
  capital_call: 'Capital call',
  distribution: 'Distribution',
  management_fee: 'Management fee',
  partnership_expense: 'Partnership expense',
  organizational_expense: 'Organizational expense',
  realized_gain: 'Realized gain',
  income: 'Income',
  valuation: 'Valuation (unrealized)',
  fx_revaluation: 'FX revaluation',
  opening_balance: 'Opening balance',
}
