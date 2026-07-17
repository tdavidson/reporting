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
import { resolvePeriod, customPeriod, type PeriodPreset, type StatementPeriod } from './statement-period'
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
  const preset = sp.get('preset') as PeriodPreset | null
  const asOf = sp.get('asOf')
  const period = preset && preset !== 'custom'
    ? resolvePeriod(preset)
    : customPeriod(sp.get('start'), sp.get('end') ?? asOf)

  // Load the WHOLE ledger (no date cutoff): the period statements need pre-period
  // history to compute beginning capital and opening cash.
  const [{ accounts, postings, capitalPostings, sourcedPostings }, names, { data: txns }, { data: companies }] = await Promise.all([
    loadPostedLedger(admin, fundId, group),
    loadEntityNames(admin, fundId, group),
    admin.from('investment_transactions' as any).select('*').eq('fund_id', fundId).order('transaction_date', { ascending: true }),
    admin.from('companies' as any).select('*').eq('fund_id', fundId),
  ])

  // Point-in-time: everything through the period end. Over-time: only the window.
  const cumulative = postingsAsOf(postings, period.end)
  const inPeriod = postingsInPeriod(postings, period.start, period.end)
  // Entry-tagged postings within the window — feeds both the cash-flow statement
  // and the GL-detail supporting schedule in the export.
  const inPeriodSourced = postingsInPeriod(sourcedPostings, period.start, period.end)

  const capitalAccounts = computeCapitalAccounts(capitalPostings, period)
  const itdCapitalAccounts = computeCapitalAccounts(capitalPostings, { end: period.end })
  const nav = totalNav(itdCapitalAccounts)

  const positions = buildSoiPositions(
    (txns as any[]) ?? [],
    ((companies as any[]) ?? []) as SoiCompany[],
    group,
    period.end ? new Date(period.end) : undefined,
  )

  const bal = accountBalances(cumulative)
  const gpAccount = accounts.find(a => a.code === '3000')
  const gpEnding = gpAccount ? normalBalance(gpAccount, bal.get(gpAccount.id) ?? 0) : 0
  const cashAccount = accounts.find(a => a.code === '1000')

  const payload: StatementPayload = {
    period,
    asOf: period.end,
    trialBalance: trialBalance(accounts, cumulative),
    balanceSheet: balanceSheet(accounts, cumulative),
    incomeStatement: incomeStatement(accounts, inPeriod),
    scheduleOfInvestments: scheduleOfInvestments(accounts, cumulative, nav, positions),
    changesInPartnersCapital: changesInPartnersCapital(capitalAccounts, names, gpEnding),
    cashFlows: cashAccount
      ? statementOfCashFlows(
          cashAccount.id,
          inPeriodSourced,
          accounts,
          openingCashBalance(cashAccount.id, sourcedPostings, period.start),
        )
      : null,
  }

  return { payload, accounts, inPeriodSourced }
}
