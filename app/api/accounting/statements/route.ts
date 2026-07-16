import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { loadPostedLedger, loadEntityNames } from '@/lib/accounting/load'
import {
  trialBalance, balanceSheet, incomeStatement, scheduleOfInvestments,
  changesInPartnersCapital, statementOfCashFlows,
  postingsInPeriod, postingsAsOf, openingCashBalance,
} from '@/lib/accounting/statements'
import { buildSoiPositions, type SoiCompany } from '@/lib/accounting/soi'
import { computeCapitalAccounts, totalNav } from '@/lib/accounting/capital-account'
import { resolvePeriod, customPeriod, type PeriodPreset } from '@/lib/accounting/statement-period'
import { accountBalances, normalBalance } from '@/lib/accounting/ledger'

// GET — the full statement package for a vehicle, scoped to a statement period:
//   ?preset=this_quarter|last_quarter|ytd|prior_year|itd   — or —
//   ?start=YYYY-MM-DD&end=YYYY-MM-DD
//
// The period means different things to different statements, and that distinction
// is the whole point:
//   • Balance sheet, trial balance, SOI  → POINT IN TIME, cumulative to `end`.
//   • Income statement, cash flows       → OVER TIME, only activity within the window.
//   • Capital accounts                   → both: opens with the balance carried in.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  // The statement of changes in partners' capital used to be withheld here from a caller without
  // lp_capital. It was theatre: the trial balance below ships the same partners and the same
  // balances, because a fund's chart has one NAMED capital account per partner. Reading the books
  // is reading partner capital — so `accounting` now implies `lp_capital` outright
  // (see DOMAIN_META.lp_capital.impliedBy) and this package is whole again.

  const sp = req.nextUrl.searchParams
  const preset = sp.get('preset') as PeriodPreset | null
  // `asOf` stays supported as a synonym for "cumulative through this date".
  const asOf = sp.get('asOf')
  const period = preset && preset !== 'custom'
    ? resolvePeriod(preset)
    : customPeriod(sp.get('start'), sp.get('end') ?? asOf)

  // Load the WHOLE ledger (no date cutoff): the period statements need pre-period
  // history to compute beginning capital and opening cash.
  const [{ accounts, postings, capitalPostings, sourcedPostings }, names, { data: txns }, { data: companies }] = await Promise.all([
    loadPostedLedger(admin, gate.fundId, group),
    loadEntityNames(admin, gate.fundId, group),
    admin.from('investment_transactions' as any).select('*').eq('fund_id', gate.fundId).order('transaction_date', { ascending: true }),
    // select('*') so `country` (migration 20260712000000) flows through once pushed,
    // without this route 400ing on an unknown column before it is.
    admin.from('companies' as any).select('*').eq('fund_id', gate.fundId),
  ])

  // Point-in-time: everything through the period end.
  const cumulative = postingsAsOf(postings, period.end)
  // Over-time: only what happened inside the window.
  const inPeriod = postingsInPeriod(postings, period.start, period.end)
  const cashInPeriod = postingsInPeriod(sourcedPostings, period.start, period.end)

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

  return NextResponse.json({
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
          cashInPeriod,
          accounts,
          openingCashBalance(cashAccount.id, sourcedPostings, period.start),
        )
      : null,
  })
}
