import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { loadPostedLedger, loadEntityNames } from '@/lib/accounting/load'
import { trialBalance, balanceSheet, incomeStatement, scheduleOfInvestments, changesInPartnersCapital, statementOfCashFlows } from '@/lib/accounting/statements'
import { computeCapitalAccounts, totalNav } from '@/lib/accounting/capital-account'
import { accountBalances, normalBalance } from '@/lib/accounting/ledger'

// GET — the full statement package for a vehicle, as of an optional date (?asOf=),
// all derived from the ledger.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const asOf = req.nextUrl.searchParams.get('asOf') || undefined

  const [{ accounts, postings, capitalPostings, sourcedPostings }, names] = await Promise.all([
    loadPostedLedger(admin, gate.fundId, group, asOf),
    loadEntityNames(admin, gate.fundId, group),
  ])

  const capitalAccounts = computeCapitalAccounts(capitalPostings)
  const nav = totalNav(capitalAccounts)

  const bal = accountBalances(postings)
  const gpAccount = accounts.find(a => a.code === '3000')
  const gpEnding = gpAccount ? normalBalance(gpAccount, bal.get(gpAccount.id) ?? 0) : 0
  const cashAccount = accounts.find(a => a.code === '1000')

  return NextResponse.json({
    asOf: asOf ?? null,
    trialBalance: trialBalance(accounts, postings),
    balanceSheet: balanceSheet(accounts, postings),
    incomeStatement: incomeStatement(accounts, postings),
    scheduleOfInvestments: scheduleOfInvestments(accounts, postings, nav),
    changesInPartnersCapital: changesInPartnersCapital(capitalAccounts, names, gpEnding),
    cashFlows: cashAccount ? statementOfCashFlows(cashAccount.id, sourcedPostings, 0) : null,
  })
}
