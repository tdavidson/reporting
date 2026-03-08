import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { logActivity } from '@/lib/activity'
import type { InvestmentTransaction, CompanyStatus } from '@/lib/types/database'
import type { CompanyInvestmentSummary, InvestmentRoundSummary } from '@/lib/types/investments'
import { xirr, type CashFlow } from '@/lib/xirr'

// ---------------------------------------------------------------------------
// Compute summary from raw transactions
// ---------------------------------------------------------------------------

function computeSummary(
  transactions: InvestmentTransaction[],
  companyStatus: CompanyStatus,
  asOfDate: Date = new Date()
): CompanyInvestmentSummary {
  let totalInvested = 0
  let totalShares = 0
  let totalRealized = 0
  let totalWrittenOff = 0
  let latestSharePrice: number | null = null
  let latestSharePriceDate: string | null = null

  const roundMap = new Map<string, InvestmentRoundSummary>()
  const roundCashFlows = new Map<string, CashFlow[]>()
  const cashFlows: CashFlow[] = []

  for (const txn of transactions) {
    if (txn.transaction_type === 'investment') {
      totalInvested += txn.investment_cost ?? 0
      totalShares += txn.shares_acquired ?? 0

      if (txn.transaction_date && txn.investment_cost) {
        const cf = { date: new Date(txn.transaction_date), amount: -(txn.investment_cost) }
        cashFlows.push(cf)
        const rn = txn.round_name ?? 'Unknown'
        if (!roundCashFlows.has(rn)) roundCashFlows.set(rn, [])
        roundCashFlows.get(rn)!.push({ ...cf })
      }

      const roundName = txn.round_name ?? 'Unknown'
      const existing = roundMap.get(roundName)
      if (existing) {
        existing.investmentCost += txn.investment_cost ?? 0
        existing.sharesAcquired += txn.shares_acquired ?? 0
        existing.interestConverted += txn.interest_converted ?? 0
        if (!existing.date && txn.transaction_date) existing.date = txn.transaction_date
        if (txn.share_price != null && txn.share_price > 0) existing.sharePrice = txn.share_price
      } else {
        roundMap.set(roundName, {
          roundName,
          date: txn.transaction_date,
          investmentCost: txn.investment_cost ?? 0,
          sharesAcquired: txn.shares_acquired ?? 0,
          sharePrice: (txn.share_price != null && txn.share_price > 0) ? txn.share_price : null,
          currentSharePrice: null,
          currentValue: 0,
          interestConverted: txn.interest_converted ?? 0,
          unrealizedValueChange: 0,
          costBasisExited: 0,
          totalRealized: 0,
          totalEscrow: 0,
          proceedsDate: null,
          grossIrr: null,
        })
      }
      // Also track share price for latest determination
      // Only use positive share prices (skip $0 from SAFEs, warrants, etc.)
      if (txn.share_price != null && txn.share_price > 0 && txn.transaction_date) {
        if (!latestSharePriceDate || txn.transaction_date > latestSharePriceDate) {
          latestSharePrice = txn.share_price
          latestSharePriceDate = txn.transaction_date
        }
      }
    }

    if (txn.transaction_type === 'proceeds') {
      const proceedsAmount = (txn.proceeds_received ?? 0) + (txn.proceeds_escrow ?? 0)
      totalRealized += proceedsAmount
      totalWrittenOff += txn.proceeds_written_off ?? 0

      if (txn.transaction_date && proceedsAmount > 0) {
        const cf = { date: new Date(txn.transaction_date), amount: proceedsAmount }
        cashFlows.push(cf)
        if (txn.round_name) {
          if (!roundCashFlows.has(txn.round_name)) roundCashFlows.set(txn.round_name, [])
          roundCashFlows.get(txn.round_name)!.push({ ...cf })
        }
      }
      // Attribute cost basis exited and proceeds to the round if specified
      if (txn.round_name) {
        const round = roundMap.get(txn.round_name)
        if (round) {
          if (txn.cost_basis_exited != null) round.costBasisExited += Math.abs(txn.cost_basis_exited)
          round.totalRealized += txn.proceeds_received ?? 0
          round.totalEscrow += txn.proceeds_escrow ?? 0
          if (txn.transaction_date) {
            if (!round.proceedsDate || txn.transaction_date > round.proceedsDate) {
              round.proceedsDate = txn.transaction_date
            }
          }
        }
      }
    }

    if (txn.transaction_type === 'unrealized_gain_change') {
      if (txn.current_share_price != null && txn.transaction_date) {
        if (!latestSharePriceDate || txn.transaction_date >= latestSharePriceDate) {
          latestSharePrice = txn.current_share_price
          latestSharePriceDate = txn.transaction_date
        }
      }
      // Attribute unrealized value change to the round if specified
      if (txn.round_name && txn.unrealized_value_change != null) {
        const round = roundMap.get(txn.round_name)
        if (round) round.unrealizedValueChange += txn.unrealized_value_change
      }
    }

    if (txn.transaction_type === 'round_info') {
      if (txn.share_price != null && txn.transaction_date) {
        if (!latestSharePriceDate || txn.transaction_date >= latestSharePriceDate) {
          latestSharePrice = txn.share_price
          latestSharePriceDate = txn.transaction_date
        }
      }
    }
  }

  // Compute per-round FMV and sum for company unrealized value
  const rounds = Array.from(roundMap.values())
  let unrealizedValue = 0
  for (const round of rounds) {
    // Use the latest share price from unrealized_gain_change / round_info transactions.
    // If none exists, fall back to the round's own share price from the investment.
    const effectiveSharePrice = latestSharePrice ?? round.sharePrice ?? null
    round.currentSharePrice = effectiveSharePrice
    const isPricedEquity = round.sharesAcquired > 0 && ((round.sharePrice != null && round.sharePrice > 0) || round.investmentCost > 0)
    // If all cost basis has been exited, there's no remaining unrealized position
    const remainingBasis = round.investmentCost - round.costBasisExited
    if (remainingBasis <= 0) {
      round.currentValue = 0
    } else if (isPricedEquity) {
      // Equity round: prorate shares by remaining basis fraction
      const fraction = round.investmentCost > 0 ? remainingBasis / round.investmentCost : 0
      round.currentValue = effectiveSharePrice != null ? round.sharesAcquired * fraction * effectiveSharePrice : 0
    } else {
      // Convertible / warrant / no shares: remaining basis + unrealized changes
      round.currentValue = Math.max(0, remainingBasis + round.unrealizedValueChange)
    }
    unrealizedValue += round.currentValue
  }

  // Compute per-round IRR
  for (const round of rounds) {
    const rcf = roundCashFlows.get(round.roundName) ?? []
    const hasInvestment = rcf.some(cf => cf.amount < 0)
    const hasProceeds = rcf.some(cf => cf.amount > 0)

    if (hasInvestment && hasProceeds) {
      // Full cash flow data available
      round.grossIrr = xirr(rcf)
    } else if (hasInvestment && !hasProceeds) {
      // Investment cash flows exist but proceeds aren't attributed to this round yet.
      // Fall back to round-level totals if we have proceeds date + amounts.
      const totalRoundProceeds = round.totalRealized + round.totalEscrow
      if (totalRoundProceeds > 0 && round.proceedsDate) {
        round.grossIrr = xirr([...rcf, { date: new Date(round.proceedsDate), amount: totalRoundProceeds }])
      } else if (companyStatus !== 'exited' && round.currentValue > 0) {
        round.grossIrr = xirr([...rcf, { date: asOfDate, amount: round.currentValue }])
      }
    }
  }

  let fmv: number
  if (companyStatus === 'exited') {
    fmv = totalRealized
  } else if (companyStatus === 'written-off') {
    fmv = 0
  } else {
    fmv = unrealizedValue
  }

  const moic = totalInvested > 0 ? (totalRealized + unrealizedValue) / totalInvested : null

  // Compute gross IRR
  let grossIrr: number | null = null
  if (cashFlows.length > 0) {
    const terminalValue = companyStatus === 'written-off' ? 0 : unrealizedValue
    if (terminalValue > 0 || totalRealized > 0) {
      if (companyStatus !== 'exited' && terminalValue > 0) {
        cashFlows.push({ date: asOfDate, amount: terminalValue })
      }
      grossIrr = xirr(cashFlows)
    }
  }

  return {
    totalInvested,
    totalShares,
    totalRealized,
    totalWrittenOff,
    latestSharePrice,
    unrealizedValue,
    fmv,
    moic,
    grossIrr,
    rounds,
  }
}

// ---------------------------------------------------------------------------
// GET — all transactions for a company + computed summary
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // Verify company exists and user has access
  const { data: company } = await admin
    .from('companies')
    .select('id, fund_id, status, portfolio_group')
    .eq('id', params.id)
    .maybeSingle()

  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const { data: membership } = await supabase
    .from('fund_members')
    .select('role')
    .eq('fund_id', company.fund_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Not a fund member' }, { status: 403 })

  const { data: transactions, error } = await admin
    .from('investment_transactions' as any)
    .select('*')
    .eq('company_id', params.id)
    .order('transaction_date', { ascending: true }) as { data: InvestmentTransaction[] | null; error: { message: string } | null }

  if (error) return dbError(error, 'companies-id-investments')

  const txns = (transactions ?? []) as InvestmentTransaction[]
  const asOf = _req.nextUrl.searchParams.get('asOf')
  const asOfDate = asOf ? new Date(asOf) : new Date()
  const summary = computeSummary(txns, company.status as CompanyStatus, asOfDate)

  // Compute per-group summaries when there are multiple groups
  const portfolioGroups: string[] = company.portfolio_group ?? []
  const groupsInTxns = new Set(txns.map(t => t.portfolio_group ?? '').filter(Boolean))
  const hasMultipleGroups = groupsInTxns.size > 1

  let groupSummaries: Record<string, CompanyInvestmentSummary> | undefined
  if (hasMultipleGroups) {
    groupSummaries = {}
    // round_info and unrealized_gain_change without a portfolio_group are company-wide;
    // include them in every group so share prices propagate correctly
    const companyWideTxns = txns.filter(t =>
      !t.portfolio_group && (t.transaction_type === 'round_info' || t.transaction_type === 'unrealized_gain_change')
    )
    for (const group of Array.from(groupsInTxns)) {
      const groupTxns = [...txns.filter(t => t.portfolio_group === group), ...companyWideTxns]
      groupSummaries[group] = computeSummary(groupTxns, company.status as CompanyStatus, asOfDate)
    }
  }

  return NextResponse.json({ transactions: txns, summary, portfolioGroups, groupSummaries })
}

// ---------------------------------------------------------------------------
// POST — create a new transaction
// ---------------------------------------------------------------------------

const VALID_TYPES = ['investment', 'proceeds', 'unrealized_gain_change', 'round_info']

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  // Verify company exists
  const { data: company } = await admin
    .from('companies')
    .select('id, fund_id')
    .eq('id', params.id)
    .maybeSingle()

  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const { data: membership } = await supabase
    .from('fund_members')
    .select('role')
    .eq('fund_id', company.fund_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Not a fund member' }, { status: 403 })

  const body = await req.json()
  const { transaction_type } = body

  if (!transaction_type || !VALID_TYPES.includes(transaction_type)) {
    return NextResponse.json({ error: 'Invalid transaction_type' }, { status: 400 })
  }

  const { data: txn, error } = await admin
    .from('investment_transactions' as any)
    .insert({
      company_id: params.id,
      fund_id: company.fund_id,
      transaction_type: body.transaction_type,
      round_name: body.round_name ?? null,
      transaction_date: body.transaction_date ?? null,
      notes: body.notes ?? null,
      investment_cost: body.investment_cost ?? null,
      interest_converted: body.interest_converted ?? 0,
      shares_acquired: body.shares_acquired ?? null,
      share_price: body.share_price ?? null,
      cost_basis_exited: body.cost_basis_exited ?? null,
      proceeds_received: body.proceeds_received ?? null,
      proceeds_escrow: body.proceeds_escrow ?? 0,
      proceeds_written_off: body.proceeds_written_off ?? 0,
      proceeds_per_share: body.proceeds_per_share ?? null,
      unrealized_value_change: body.unrealized_value_change ?? null,
      current_share_price: body.current_share_price ?? null,
      postmoney_valuation: body.postmoney_valuation ?? null,
      ownership_pct: body.ownership_pct ?? null,
      latest_postmoney_valuation: body.latest_postmoney_valuation ?? null,
      exit_valuation: body.exit_valuation ?? null,
      original_currency: body.original_currency ?? null,
      original_investment_cost: body.original_investment_cost ?? null,
      original_share_price: body.original_share_price ?? null,
      original_postmoney_valuation: body.original_postmoney_valuation ?? null,
      original_proceeds_received: body.original_proceeds_received ?? null,
      original_proceeds_per_share: body.original_proceeds_per_share ?? null,
      original_exit_valuation: body.original_exit_valuation ?? null,
      original_unrealized_value_change: body.original_unrealized_value_change ?? null,
      original_current_share_price: body.original_current_share_price ?? null,
      original_latest_postmoney_valuation: body.original_latest_postmoney_valuation ?? null,
      portfolio_group: body.portfolio_group ?? null,
    })
    .select('*')
    .single() as { data: InvestmentTransaction | null; error: { message: string } | null }

  if (error) return dbError(error, 'companies-id-investments-post')

  logActivity(admin, company.fund_id, user.id, 'investment.create', {
    companyId: params.id,
    transactionType: transaction_type,
  })

  return NextResponse.json(txn)
}
