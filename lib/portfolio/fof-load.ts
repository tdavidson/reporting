import type { SupabaseClient } from '@supabase/supabase-js'
import { computeFundPositions, type FundPosition } from './fof-metrics'
import type { ManagerStatementFigures } from './fof-valuation'

/**
 * The one place fund-of-funds positions are loaded from the database.
 *
 * Everything downstream — the holdings list, the quarterly grid, the pre-close check, the
 * exhibits — reads the SAME positions from the SAME computation. Three surfaces each running
 * their own query and their own mapping is how the grid and the close end up disagreeing
 * about a partner's unfunded commitment.
 *
 * The computation itself stays pure in fof-metrics.ts; this module is only the I/O around it.
 */

export interface FofData {
  positions: FundPosition[]
  /** The manager's own since-inception figures, for the tie-out. Empty when none reported. */
  managerFigures: ManagerStatementFigures[]
  /** Raw register rows, for surfaces that show the notices themselves. */
  events: any[]
  navStatements: any[]
}

/** The raw register rows, loaded once. Windowed computation happens in computeFofFromRaw. */
export interface FofRawData {
  holdings: { id: string; name: string }[]
  terms: any[]
  events: any[]
  navs: any[]
}

/**
 * Load the register WITHOUT computing anything, so a caller that needs several as-of dates
 * (the statement package with comparison periods) pays for one round trip rather than one
 * per window.
 */
export async function loadFofRaw(admin: SupabaseClient, fundId: string): Promise<FofRawData | null> {
  const { data: holdings } = await admin
    .from('companies').select('id, name')
    .eq('fund_id', fundId).eq('holding_type', 'fund').order('name')
  const holdingRows = ((holdings as any[]) ?? [])
  if (holdingRows.length === 0) return null

  const [{ data: terms }, { data: events }, { data: navs }] = await Promise.all([
    (admin as any).from('fund_holding_terms').select('*').eq('fund_id', fundId),
    (admin as any).from('fund_capital_events').select('*').eq('fund_id', fundId).order('event_date'),
    (admin as any).from('fund_nav_statements').select('*').eq('fund_id', fundId).order('as_of_date'),
  ])

  return {
    holdings: holdingRows.map(h => ({ id: h.id, name: h.name })),
    terms: ((terms as any[]) ?? []),
    events: ((events as any[]) ?? []),
    navs: ((navs as any[]) ?? []),
  }
}

/** Positions and manager figures at one as-of date. Pure over already-loaded rows. */
export function computeFofFromRaw(raw: FofRawData, asOf: string): {
  positions: FundPosition[]
  managerFigures: ManagerStatementFigures[]
} {
  const termByCompany = new Map(raw.terms.map(t => [t.company_id, t]))

  const positions = computeFundPositions({
    asOf,
    terms: raw.holdings.map(h => {
      const t: any = termByCompany.get(h.id)
      return {
        companyId: h.id,
        name: h.name,
        managerName: t?.manager_name ?? null,
        vintageYear: t?.vintage_year ?? null,
        strategy: t?.strategy ?? null,
        commitment: Number(t?.commitment ?? 0),
      }
    }),
    events: raw.events.map(e => ({
      companyId: e.company_id,
      kind: e.kind,
      eventDate: e.event_date,
      amount: Number(e.amount),
      recallableAmount: Number(e.recallable_amount ?? 0),
      charReturnOfCapital: Number(e.char_return_of_capital ?? 0),
      charRealizedGain: Number(e.char_realized_gain ?? 0),
      charIncome: Number(e.char_income ?? 0),
    })),
    navs: raw.navs.map(n => ({
      companyId: n.company_id,
      asOfDate: n.as_of_date,
      reportedNav: Number(n.reported_nav),
      basis: n.basis,
    })),
  })

  // Tie out against the NEWEST statement on or before the reporting date — the same one the
  // position is carried on. An older statement's since-inception figures would disagree with
  // our register for the perfectly good reason that time passed.
  const newestByCompany = new Map<string, any>()
  for (const n of raw.navs) {
    if (n.as_of_date > asOf) continue
    const cur = newestByCompany.get(n.company_id)
    if (!cur || n.as_of_date > cur.as_of_date) newestByCompany.set(n.company_id, n)
  }
  const managerFigures: ManagerStatementFigures[] = Array.from(newestByCompany.values()).map(n => ({
    companyId: n.company_id,
    reportedContributions: n.reported_contributions === null ? null : Number(n.reported_contributions),
    reportedDistributions: n.reported_distributions === null ? null : Number(n.reported_distributions),
    reportedUnfunded: n.reported_unfunded === null ? null : Number(n.reported_unfunded),
  }))

  return { positions, managerFigures }
}

/** Convenience: load and compute at one date. Delegates, so there is one mapping, not two. */
export async function loadFofData(
  admin: SupabaseClient,
  fundId: string,
  asOf: string,
): Promise<FofData> {
  const raw = await loadFofRaw(admin, fundId)
  if (!raw) return { positions: [], managerFigures: [], events: [], navStatements: [] }
  const { positions, managerFigures } = computeFofFromRaw(raw, asOf)
  return { positions, managerFigures, events: raw.events, navStatements: raw.navs }
}

/**
 * What the LEDGER carries per fund holding: its cost account plus its accumulated mark, the
 * per-holding pair ensureInvestmentAccounts creates. Takes an already-loaded ledger because
 * every caller has one — loading it twice is the expensive mistake here.
 */
export function ledgerCarryingByHolding(
  accounts: { id: string; companyId?: string | null; subtype?: string | null }[],
  postings: { accountId: string; amount: number }[],
): Map<string, number> {
  const byAccount = new Map(accounts.map(a => [a.id, a]))
  const out = new Map<string, number>()
  for (const p of postings) {
    const acct = byAccount.get(p.accountId)
    if (!acct?.companyId) continue
    if (acct.subtype !== 'investment' && acct.subtype !== 'unrealized') continue
    out.set(acct.companyId, round2((out.get(acct.companyId) ?? 0) + p.amount))
  }
  return out
}

const round2 = (n: number) => Math.round(n * 100) / 100
