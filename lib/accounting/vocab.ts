// The words a statement uses for its equity, by vehicle kind. Pure, dependency-free.
//
// "Partners' capital" is right for a fund and wrong for everything that has no partners: a
// management company's balance sheet says members' capital, an individual's says owner's
// equity. The label was hard-coded in the statements, the workbook, the PDF and the status
// checks; it resolves here so the four cannot disagree.

import { closesToOwnerEquity } from '@/lib/vehicle-kinds'

/** The equity section's label on the balance sheet. */
export function equityLabel(kind: string | null | undefined): string {
  if (kind === 'individual') return "Owner's equity"
  if (kind === 'manco') return "Members' capital"
  return "Partners' capital"
}

/** The people (or person) the close's net income goes to, for a memo or a sentence. */
export function ownerNoun(kind: string | null | undefined): string {
  if (kind === 'individual') return 'the owner'
  if (kind === 'manco') return 'the members'
  return 'the partners'
}

export { closesToOwnerEquity }
