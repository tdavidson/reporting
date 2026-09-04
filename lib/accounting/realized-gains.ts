// Realized gains by lot — the Schedule D / Form 8949 input. Pure.
//
// For each disposal in the window: the lots it consumed under the vehicle's lot method
// (lib/portfolio/lots.ts), proceeds and gain apportioned to each lot by its share of the basis
// (the same apportionment lib/accounting/holding-period.ts uses for the K-1 split), and whether
// each lot was held long enough to be long-term. An individual's preparer keys this straight
// onto the return; a fund's preparer reconciles the K-1's box 8 and 9a to it.

import { disposalBasis, type LotMethod } from '@/lib/portfolio/lots'
import { isLongTerm } from './holding-period'
import { roundCents } from './ledger'

type Txn = Parameters<typeof disposalBasis>[0][number]

export type HoldingTerm = 'short' | 'long' | 'undetermined'

export interface RealizedLotRow {
  companyId: string
  company: string
  acquired: string | null
  sold: string
  units: number
  proceeds: number
  basis: number
  gain: number
  term: HoldingTerm
}

export interface RealizedDisposalRow {
  companyId: string
  company: string
  sold: string
  units: number
  proceeds: number
  basis: number
  gain: number
  /** Units the disposal claimed that no lot supplied — a purchase never recorded. */
  unmatchedUnits: number
  lots: RealizedLotRow[]
}

export interface RealizedGainsTotals {
  proceeds: number
  basis: number
  gain: number
  shortTerm: number
  longTerm: number
  undetermined: number
}

export interface RealizedGains {
  method: LotMethod
  period: { start: string | null; end: string | null }
  disposals: RealizedDisposalRow[]
  totals: RealizedGainsTotals
}

/** Proceeds recognised on a disposal row — cash plus escrow, as the tracker counts them. */
function proceedsOf(t: any): number {
  return Number(t.proceeds_received ?? 0) + Number(t.proceeds_escrow ?? 0)
}

export function realizedGains(
  txns: Txn[],
  companies: { id: string; name: string }[],
  method: LotMethod,
  period: { start?: string | null; end?: string | null } = {},
): RealizedGains {
  const start = period.start ?? null
  const end = period.end ?? null
  const nameById = new Map(companies.map(c => [c.id, c.name]))

  const byCompany = new Map<string, Txn[]>()
  for (const t of txns) {
    const key = (t as any).company_id as string | null
    if (!key) continue
    const list = byCompany.get(key) ?? []
    list.push(t)
    byCompany.set(key, list)
  }

  const disposals: RealizedDisposalRow[] = []
  for (const [companyId, rows] of Array.from(byCompany.entries())) {
    const company = nameById.get(companyId) ?? companyId
    const proceedsByTxn = new Map<string, number>(
      rows.filter(r => (r as any).transaction_type === 'proceeds').map(r => [(r as any).id as string, proceedsOf(r)]),
    )
    for (const b of disposalBasis(rows, method)) {
      if (start && b.date < start) continue
      if (end && b.date > end) continue
      const proceeds = roundCents(proceedsByTxn.get(b.txnId) ?? 0)
      const basis = roundCents(b.recordedBasis ?? b.computedBasis)
      const gain = roundCents(proceeds - basis)
      const allocations = b.allocations ?? []
      const allocatedBasis = allocations.reduce((s, a) => s + a.cost, 0)

      const lots: RealizedLotRow[] = []
      if (allocations.length === 0 || allocatedBasis === 0) {
        // Average cost, or a disposal no lot could supply: one line, term unknown.
        lots.push({ companyId, company, acquired: null, sold: b.date, units: b.units, proceeds, basis, gain, term: 'undetermined' })
      } else {
        let assignedProceeds = 0
        let assignedGain = 0
        allocations.forEach((a, i) => {
          const last = i === allocations.length - 1
          const lotProceeds = last ? roundCents(proceeds - assignedProceeds) : roundCents((proceeds * a.cost) / allocatedBasis)
          const lotGain = last ? roundCents(gain - assignedGain) : roundCents((gain * a.cost) / allocatedBasis)
          assignedProceeds = roundCents(assignedProceeds + lotProceeds)
          assignedGain = roundCents(assignedGain + lotGain)
          lots.push({
            companyId, company, acquired: a.lotDate, sold: b.date, units: a.units,
            proceeds: lotProceeds, basis: roundCents(a.cost), gain: lotGain,
            term: isLongTerm(a.lotDate, b.date) ? 'long' : 'short',
          })
        })
      }
      disposals.push({ companyId, company, sold: b.date, units: b.units, proceeds, basis, gain, unmatchedUnits: b.unmatchedUnits, lots })
    }
  }

  disposals.sort((a, b) => a.sold.localeCompare(b.sold) || a.company.localeCompare(b.company))

  const totals = disposals.reduce<RealizedGainsTotals>((acc, d) => {
    acc.proceeds = roundCents(acc.proceeds + d.proceeds)
    acc.basis = roundCents(acc.basis + d.basis)
    acc.gain = roundCents(acc.gain + d.gain)
    for (const l of d.lots) {
      if (l.term === 'short') acc.shortTerm = roundCents(acc.shortTerm + l.gain)
      else if (l.term === 'long') acc.longTerm = roundCents(acc.longTerm + l.gain)
      else acc.undetermined = roundCents(acc.undetermined + l.gain)
    }
    return acc
  }, { proceeds: 0, basis: 0, gain: 0, shortTerm: 0, longTerm: 0, undetermined: 0 })

  return { method, period: { start, end }, disposals, totals }
}

export const REALIZED_GAINS_HEADER = ['Company', 'Acquired', 'Sold', 'Units', 'Proceeds', 'Basis', 'Gain / (loss)', 'Term']

/** One row per lot — the 8949 layout — with a totals row. */
export function realizedGainsRows(r: RealizedGains): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [REALIZED_GAINS_HEADER]
  for (const d of r.disposals) {
    for (const l of d.lots) {
      rows.push([l.company, l.acquired ?? 'unknown', l.sold, l.units, l.proceeds, l.basis, l.gain, l.term === 'long' ? 'Long-term' : l.term === 'short' ? 'Short-term' : 'Undetermined'])
    }
  }
  rows.push(['Total', '', '', null, r.totals.proceeds, r.totals.basis, r.totals.gain, ''])
  rows.push(['  of which short-term', '', '', null, null, null, r.totals.shortTerm, ''])
  rows.push(['  of which long-term', '', '', null, null, null, r.totals.longTerm, ''])
  if (r.totals.undetermined !== 0) rows.push(['  of which undetermined', '', '', null, null, null, r.totals.undetermined, ''])
  return rows
}
