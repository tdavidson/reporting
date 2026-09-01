import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertReadAccess, assertWriteAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { fundEconomics } from '@/lib/accounting/fund-economics'
import { loadPostedLedger } from '@/lib/accounting/load'
import { accountBalances, normalBalance } from '@/lib/accounting/ledger'
import { buildSoiPositions, txnsForVehicle, type SoiCompany } from '@/lib/accounting/soi'
import { parseAssumptions, type ConstructionActuals } from '@/lib/accounting/construction'
import type { Account } from '@/lib/accounting/types'
import type { InvestmentTransaction } from '@/lib/types/database'

// Portfolio construction: the derived actuals plus this vehicle's stored assumptions.
//
// The ACTUALS never come from the client. The page recomputes the model in the browser on every
// keystroke using the same pure function, but over numbers THIS route derived — so nothing a
// user types can move committed capital, fees incurred, or capital deployed.
//
// accounting domain (lib/access/route-domains.ts). The registry derives the level from the
// method, so GET needs read and PUT needs write with no extra check here.

/** ITD balance of every expense account with a given subtype, in its normal (positive) sense. */
function expenseTotal(accounts: Account[], balances: Map<string, number>, subtype: string): number {
  return accounts
    .filter(a => a.type === 'expense' && a.subtype === subtype)
    .reduce((s, a) => s + normalBalance(a, balances.get(a.id) ?? 0), 0)
}

async function loadActuals(
  admin: ReturnType<typeof createAdminClient>,
  fundId: string,
  group: string,
): Promise<{ actuals: ConstructionActuals; vintageYear: number | null; vehicleId: string | null }> {
  const [vehicles, ledger, txnRes, coRes] = await Promise.all([
    fundEconomics(admin, fundId),
    // A vehicle that is not on fund accounting has no ledger to load; that is a state, not an
    // error, so it resolves to null and `ledgerAvailable` reports it downstream.
    loadPostedLedger(admin, fundId, group).catch(() => null),
    // `as any` because `holding_type` and `country` postdate the last types regeneration —
    // the same escape hatch close.ts:519 and lib/vehicles.ts use for the same reason.
    (admin as any).from('investment_transactions').select('*').eq('fund_id', fundId),
    (admin as any).from('companies')
      .select('id, name, holding_type, status, industry, stage, country, portfolio_group')
      .eq('fund_id', fundId),
  ])

  const econ = vehicles.find(v => v.vehicle === group) ?? null

  // Reported as ABSENT rather than as 0: zeroes here would silently claim the fund has spent
  // nothing on fees and expenses, which overstates investable capital by the whole fee load.
  const ledgerAvailable = !!ledger && ledger.accounts.length > 0
  let managementFeesIncurred = 0
  let orgCostsIncurred = 0
  let partnershipExpensesIncurred = 0
  if (ledger && ledgerAvailable) {
    const bal = accountBalances(ledger.postings)
    managementFeesIncurred = expenseTotal(ledger.accounts, bal, 'management_fee')
    orgCostsIncurred = expenseTotal(ledger.accounts, bal, 'organizational_expense')
    partnershipExpensesIncurred = expenseTotal(ledger.accounts, bal, 'partnership_expense')
  }

  // includeRealized: an exited company's initial check is still capital this fund deployed.
  // Leaving it out would understate deployment and overstate what is left to invest — the one
  // number this whole page exists to get right.
  const positions = buildSoiPositions(
    (txnRes.data ?? []) as InvestmentTransaction[],
    (coRes.data ?? []) as SoiCompany[],
    group,
    undefined,
    { includeRealized: true },
  )
  const allTxns = (txnRes.data ?? []) as InvestmentTransaction[]
  const byCompany = new Map<string, InvestmentTransaction[]>()
  for (const txn of allTxns) {
    const list = byCompany.get(txn.company_id) ?? []
    list.push(txn)
    byCompany.set(txn.company_id, list)
  }

  const constructionPositions = positions.map(position => {
    const relevant = txnsForVehicle(byCompany.get(position.companyId) ?? [], group)
      .sort((x, y) => (x.transaction_date ?? '').localeCompare(y.transaction_date ?? ''))
    const firstInvestment = relevant.find(t => t.transaction_type === 'investment')
    let currentOwnership: number | null = null
    let currentPostMoney: number | null = null
    for (const txn of relevant) {
      if (txn.ownership_pct != null) currentOwnership = Number(txn.ownership_pct) / 100
      const postMoney = txn.latest_postmoney_valuation ?? txn.postmoney_valuation
      if (postMoney != null) currentPostMoney = Number(postMoney)
    }
    return {
      companyId: position.companyId,
      name: position.name,
      stage: firstInvestment?.round_name ?? position.stage,
      status: position.status,
      investedInitial: position.investedNew,
      investedFollowOn: position.investedFollowOn,
      investedTotal: position.invested,
      // A fully exited position has no residual value. Its cash is reported separately as
      // realized proceeds and still participates in realized MOIC and fund return calculations.
      currentValue: position.status === 'exited' ? 0 : position.totalValue,
      currentMoic: position.moic,
      currentOwnership,
      currentPostMoney,
      distributions: position.distributions,
    }
  })

  return {
    vintageYear: econ?.vintageYear ?? null,
    vehicleId: econ?.id ?? null,
    actuals: {
      committedCapital: econ?.fund.committed ?? 0,
      calledCapital: econ?.fund.paidIn ?? 0,
      uncalledCapital: econ?.fund.uncalled ?? 0,
      managementFeesIncurred,
      orgCostsIncurred,
      partnershipExpensesIncurred,
      ledgerAvailable,
      deployedInitial: positions.reduce((s, p) => s + p.investedNew, 0),
      deployedFollowOn: positions.reduce((s, p) => s + p.investedFollowOn, 0),
      companyCount: positions.length,
      currentValue: constructionPositions.reduce((s, p) => s + p.currentValue, 0),
      nav: econ?.fund.nav ?? 0,
      positions: constructionPositions,
    },
  }
}

/** snake_case row → the camelCase shape parseAssumptions reads. */
function fromRow(row: Record<string, unknown>) {
  return {
    feeAnnualRate: Number(row.fee_annual_rate),
    feeBasis: row.fee_basis,
    feeTermYears: Number(row.fee_term_years),
    feeStartDate: row.fee_start_date ?? '',
    feeStepDownYear: row.fee_step_down_year == null ? null : Number(row.fee_step_down_year),
    feeStepDownRate: row.fee_step_down_rate == null ? null : Number(row.fee_step_down_rate),
    annualPartnershipExpense: Number(row.annual_partnership_expense),
    remainingOrgCosts: Number(row.remaining_org_costs),
    // Target-company and target-return controls are retired from the current analysis. Leave the
    // legacy columns in place for a reversible rollout, but do not let old values drive warnings.
    targetPortfolioSize: 0,
    targetFundMultiple: 0,
    stages: row.stages,
    positionForecasts: row.position_forecasts,
  }
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  try {
    const { actuals, vintageYear, vehicleId } = await loadActuals(admin, gate.fundId, group)
    // `as any`: fund_construction_models is created by migration 20260831000000, which has not
    // been pushed, so it is not yet in the generated Database types.
    const { data: row } = vehicleId
      ? await (admin as any).from('fund_construction_models').select('*')
          .eq('fund_id', gate.fundId).eq('vehicle_id', vehicleId).maybeSingle()
      : { data: null }

    // No row yet is not an error: a vehicle that has never been planned gets the defaults, and
    // the first PUT is what creates it.
    return NextResponse.json({
      group,
      vehicleId,
      actuals,
      assumptions: parseAssumptions(row ? fromRow(row) : null, vintageYear),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)
  if (!vehicleId) {
    return NextResponse.json(
      { error: 'This vehicle has no registry row, so a construction model cannot be stored for it.' },
      { status: 400 },
    )
  }

  const body = await req.json().catch(() => null)
  const { vintageYear } = await loadActuals(admin, gate.fundId, group)
  // Parsed BEFORE the write, not after: the table's CHECK constraint only guards fee_basis, so
  // this is the boundary that stops a malformed stage reaching storage.
  const a = parseAssumptions(body, vintageYear)

  const { error } = await (admin as any).from('fund_construction_models').upsert({
    fund_id: gate.fundId,
    vehicle_id: vehicleId,
    fee_annual_rate: a.feeAnnualRate,
    fee_basis: a.feeBasis,
    fee_term_years: a.feeTermYears,
    fee_start_date: a.feeStartDate || null,
    fee_step_down_year: a.feeStepDownYear,
    fee_step_down_rate: a.feeStepDownRate,
    annual_partnership_expense: a.annualPartnershipExpense,
    remaining_org_costs: a.remainingOrgCosts,
    target_portfolio_size: 0,
    // Clear the retired buffer on the next save while retaining the legacy column until every
    // deployed environment has crossed this release.
    existing_reserve_pool: 0,
    target_fund_multiple: 0,
    stages: a.stages,
    position_forecasts: a.positionForecasts,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'fund_id,vehicle_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ assumptions: a })
}
