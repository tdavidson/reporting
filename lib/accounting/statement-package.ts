// The full statement package for one vehicle, scoped to a statement period.
//
// Extracted from the /api/accounting/statements route so the on-screen statements
// and the Excel workpaper export are computed by ONE function — a tax workpaper
// that disagreed with the numbers on the Statements page would be worse than no
// export at all. Both callers pass the resolved `group` and the request's search
// params; everything downstream is identical.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  trialBalance, balanceSheet, incomeStatement, scheduleOfInvestments,
  changesInPartnersCapital, statementOfCashFlows,
  postingsInPeriod, postingsAsOf, openingCashBalance,
  type TrialBalance, type BalanceSheet, type IncomeStatement,
  type ScheduleOfInvestments, type ChangesInPartnersCapital, type StatementOfCashFlows,
} from './statements'
import { loadPostedLedger, loadEntityNames, type SourcedPosting } from './load'
import { buildSoiPositions, type SoiCompany } from './soi'
import { computeCapitalAccounts, totalNav } from './capital-account'
import { resolvePeriod, customPeriod, comparisonPeriods, type PeriodPreset, type StatementPeriod } from './statement-period'
import { accountBalances, normalBalance } from './ledger'
import type { Account } from './types'

/** The JSON body the statements route returns — the on-screen statement set. */
export interface StatementPayload {
  period: StatementPeriod
  asOf: string | null
  trialBalance: TrialBalance
  balanceSheet: BalanceSheet
  incomeStatement: IncomeStatement
  scheduleOfInvestments: ScheduleOfInvestments
  changesInPartnersCapital: ChangesInPartnersCapital
  cashFlows: StatementOfCashFlows | null
}

export interface StatementPackage {
  /** Exactly what the statements API returns — do not add fields the UI doesn't expect. */
  payload: StatementPayload
  // Extras the workpaper export needs beyond the on-screen payload:
  /** The vehicle's chart, for the GL-detail supporting schedule. */
  accounts: Account[]
  /** Postings within the period window, entry-tagged — the GL-detail rows. */
  inPeriodSourced: SourcedPosting[]
  /** Prior-period payloads, most-recent-first, present only when ?compare= was passed. */
  comparisons?: StatementPayload[]
}

export interface LedgerData {
  accounts: Account[]
  postings: Awaited<ReturnType<typeof loadPostedLedger>>['postings']
  capitalPostings: Awaited<ReturnType<typeof loadPostedLedger>>['capitalPostings']
  sourcedPostings: SourcedPosting[]
  names: Awaited<ReturnType<typeof loadEntityNames>>
  txns: any[]
  companies: any[]
  group: string
  cashAccount: Account | undefined
  gpAccount: Account | undefined
  /** Min entryDate across postings — the inception bound for comparison stepping. */
  earliest: string | null
}

/** Min entryDate across postings, ignoring nulls. */
export function earliestPostingDate(postings: { entryDate?: string | null }[]): string | null {
  let min: string | null = null
  for (const p of postings) {
    const d = p.entryDate
    if (d && (min === null || d < min)) min = d
  }
  return min
}

/** One DB load, reused across every period window. */
export async function loadLedgerData(admin: SupabaseClient, fundId: string, group: string): Promise<LedgerData> {
  const [{ accounts, postings, capitalPostings, sourcedPostings }, names, { data: txns }, { data: companies }] = await Promise.all([
    loadPostedLedger(admin, fundId, group),
    loadEntityNames(admin, fundId, group),
    admin.from('investment_transactions' as any).select('*').eq('fund_id', fundId).order('transaction_date', { ascending: true }),
    // Every holding, fund and company alike: both carry 1100/1200 balances, so the SOI's
    // ledger control total only ties if both are present. The SOI splits them for DISPLAY by
    // holding_type — see SoiPosition.holdingType — rather than by excluding either here.
    admin.from('companies' as any).select('*').eq('fund_id', fundId),
  ])
  return {
    accounts, postings, capitalPostings, sourcedPostings, names,
    txns: (txns as any[]) ?? [],
    companies: (companies as any[]) ?? [],
    group,
    cashAccount: accounts.find(a => a.code === '1000'),
    gpAccount: accounts.find(a => a.code === '3000'),
    earliest: earliestPostingDate(postings),
  }
}

/** The per-window statement math — pure over already-loaded ledger data. */
export function computePayload(data: LedgerData, period: StatementPeriod): StatementPayload {
  const cumulative = postingsAsOf(data.postings, period.end)
  const inPeriod = postingsInPeriod(data.postings, period.start, period.end)
  const inPeriodSourced = postingsInPeriod(data.sourcedPostings, period.start, period.end)

  const capitalAccounts = computeCapitalAccounts(data.capitalPostings, period)
  const itdCapitalAccounts = computeCapitalAccounts(data.capitalPostings, { end: period.end })
  const nav = totalNav(itdCapitalAccounts)

  const positions = buildSoiPositions(
    data.txns, data.companies as SoiCompany[], data.group,
    period.end ? new Date(period.end) : undefined,
  )

  const bal = accountBalances(cumulative)
  const gpEnding = data.gpAccount ? normalBalance(data.gpAccount, bal.get(data.gpAccount.id) ?? 0) : 0

  return {
    period,
    asOf: period.end,
    trialBalance: trialBalance(data.accounts, cumulative),
    balanceSheet: balanceSheet(data.accounts, cumulative),
    incomeStatement: incomeStatement(data.accounts, inPeriod),
    scheduleOfInvestments: scheduleOfInvestments(data.accounts, cumulative, nav, positions),
    changesInPartnersCapital: changesInPartnersCapital(capitalAccounts, data.names, gpEnding),
    cashFlows: data.cashAccount
      ? statementOfCashFlows(
          data.cashAccount.id, inPeriodSourced, data.accounts,
          openingCashBalance(data.cashAccount.id, data.sourcedPostings, period.start),
        )
      : null,
  }
}

/**
 * Build the whole statement package for a vehicle. `sp` is the request's search
 * params; the period is resolved the same way for every caller:
 *   ?preset=this_quarter|last_quarter|ytd|prior_year|itd   — or —
 *   ?start=YYYY-MM-DD&end=YYYY-MM-DD   (?asOf= is a synonym for a cumulative end)
 */
export async function buildStatementPackage(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  sp: URLSearchParams,
): Promise<StatementPackage> {
  const data = await loadLedgerData(admin, fundId, group)

  const preset = sp.get('preset') as PeriodPreset | null
  const asOf = sp.get('asOf')
  const asOfDate = asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? new Date(asOf) : undefined
  const period = preset && preset !== 'custom'
    ? resolvePeriod(preset, asOfDate)
    : customPeriod(sp.get('start'), sp.get('end') ?? asOf)

  const payload = computePayload(data, period)
  const inPeriodSourced = postingsInPeriod(data.sourcedPostings, period.start, period.end)

  const compareParam = sp.get('compare')
  let comparisons: StatementPayload[] | undefined
  if (compareParam) {
    const count = compareParam === 'all' ? Infinity : Math.max(0, parseInt(compareParam, 10) || 0)
    comparisons = comparisonPeriods(period, count, data.earliest).map(p => computePayload(data, p))
  }

  return { payload, accounts: data.accounts, inPeriodSourced, comparisons }
}
