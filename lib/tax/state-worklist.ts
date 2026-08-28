// Where a partnership may owe a state filing, and for whom.
//
// WHAT THIS DELIBERATELY DOES NOT DO: apply any state's rules. Composite-return eligibility,
// withholding rates, exemption thresholds and filing deadlines differ across fifty-odd
// jurisdictions and change every year. Encoding them here would produce an answer that is
// authoritative-looking and quietly stale — the worst kind, because nobody re-checks a number
// the software gave them.
//
// So this produces the WORKLIST: which states have partners, how many, how much income was
// allocated to them, and which are nonresidents of the fund's own state. That is the input a
// preparer needs and the part the books actually know. The rules stay with whoever is licensed
// to apply them.

import { roundCents } from '@/lib/accounting/ledger'

export interface PartnerStateRow {
  lpEntityId: string
  name: string
  /** Two-letter state from the signed form, or null when unknown or foreign. */
  state: string | null
  country: string | null
  /** The partner's allocated income for the year — what a withholding calculation starts from. */
  allocatedIncome: number
}

export interface StateGroup {
  state: string
  partners: number
  allocatedIncome: number
  /** True when this is not the state the partnership itself files in. */
  nonresident: boolean
  names: string[]
}

export interface StateWorklist {
  /** One group per state with at least one partner, largest income first. */
  states: StateGroup[]
  /** Foreign partners, who raise withholding questions of a different kind entirely. */
  foreign: PartnerStateRow[]
  /** Partners whose state is not recorded — a gap to close, not a state to file in. */
  unknown: PartnerStateRow[]
  /** The partnership's own state, when the caller supplied one. */
  homeState: string | null
}

const US = new Set(['US', 'USA', 'UNITED STATES'])

function isForeign(row: PartnerStateRow): boolean {
  if (!row.country) return false
  return !US.has(row.country.trim().toUpperCase())
}

/**
 * Group partners by state.
 *
 * Foreign partners are separated rather than bucketed under "unknown": a partner in Germany is
 * not a missing address, and the question they raise — treaty rates, FDAP and ECI withholding —
 * has nothing to do with a state composite return. Conflating the two would bury both.
 */
export function buildStateWorklist(
  rows: PartnerStateRow[],
  homeState: string | null,
): StateWorklist {
  const foreign = rows.filter(isForeign)
  const domestic = rows.filter(r => !isForeign(r))
  const unknown = domestic.filter(r => !r.state)

  const byState = new Map<string, PartnerStateRow[]>()
  for (const r of domestic) {
    if (!r.state) continue
    const list = byState.get(r.state) ?? []
    list.push(r)
    byState.set(r.state, list)
  }

  const home = homeState ? homeState.trim().toUpperCase() : null
  const states: StateGroup[] = Array.from(byState.entries())
    .map(([state, list]) => ({
      state,
      partners: list.length,
      allocatedIncome: roundCents(list.reduce((s, r) => s + r.allocatedIncome, 0)),
      nonresident: home !== null && state !== home,
      names: list.map(r => r.name),
    }))
    .sort((a, b) => Math.abs(b.allocatedIncome) - Math.abs(a.allocatedIncome) || a.state.localeCompare(b.state))

  return { states, foreign, unknown, homeState: home }
}

/**
 * A plain-language summary of what the worklist implies, without saying what to file.
 *
 * Written as observations rather than instructions: "eleven partners in six states other than
 * yours" is a fact the books support. "You must file a composite return in California" is not,
 * and this module is not the place it should come from.
 */
export function summarizeWorklist(w: StateWorklist): string[] {
  const out: string[] = []
  const nonresident = w.states.filter(s => s.nonresident)
  if (nonresident.length > 0) {
    const partners = nonresident.reduce((s, g) => s + g.partners, 0)
    out.push(
      `${partners} partner${partners === 1 ? '' : 's'} in ${nonresident.length} state${nonresident.length === 1 ? '' : 's'} ` +
        `other than ${w.homeState}: ${nonresident.map(s => s.state).join(', ')}. Each may raise a composite ` +
        'return or nonresident withholding obligation.',
    )
  }
  if (w.foreign.length > 0) {
    out.push(
      `${w.foreign.length} foreign partner${w.foreign.length === 1 ? '' : 's'}. Withholding for these is a ` +
        'federal question — treaty rates and the character of the income — not a state one.',
    )
  }
  if (w.unknown.length > 0) {
    out.push(
      `${w.unknown.length} partner${w.unknown.length === 1 ? ' has' : 's have'} no state recorded on their tax ` +
        'form, so they appear in no state below. Record it before relying on this list.',
    )
  }
  if (out.length === 0) out.push('Every partner is in the fund’s own state.')
  return out
}
