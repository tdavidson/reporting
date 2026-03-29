import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { InvestmentTransaction, CompanyStatus } from '@/lib/types/database'
import { xirr, type CashFlow } from '@/lib/xirr'

interface DataPoint {
  date: string       // YYYY-MM-DD (last day of month)
  nav: number        // (unrealized + proceeds) / invested * 100  — base 100
  irr: number | null // rolling XIRR annualised, as decimal (e.g. 0.15 = 15%)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m, 0).toISOString().split('T')[0]
}

function monthRange(startYM: string, endYM: string): string[] {
  const months: string[] = []
  let [y, m] = startYM.split('-').map(Number)
  const [ey, em] = endYM.split('-').map(Number)
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`)
    if (++m > 12) { m = 1; y++ }
  }
  return months
}

function toYM(dateStr: string) { return dateStr.slice(0, 7) }

// Same unrealized-value logic as investments/route.ts
function calcUnrealized(
  status: CompanyStatus | string | null,
  explicitNav: number | null,
  ownership: number | null,
  valuation: number | null,
  sharePrice: number | null,
  totalShares: number,
  totalInvested: number,
  unrealizedDelta: number,   // sum of unrealized_value_change deltas via roundMap
  costBasisExited: number,
): number {
  if (status === 'written-off') return 0
  if (explicitNav != null) return Math.max(0, explicitNav)
  if (ownership != null && valuation != null) return Math.max(0, (ownership / 100) * valuation)
  if (sharePrice != null && totalShares > 0) return Math.max(0, sharePrice * totalShares)
  return Math.max(0, totalInvested + unrealizedDelta - costBasisExited)
}

// ---------------------------------------------------------------------------
// GET /api/benchmarks/nav-series?group=<name>
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const group = req.nextUrl.searchParams.get('group') ?? ''

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund' }, { status: 403 })

  const fundId = membership.fund_id

  // -- companies map (for status + default group fallback) --
  const { data: companies } = await admin
    .from('companies')
    .select('id, status, portfolio_group')
    .eq('fund_id', fundId) as {
      data: { id: string; status: CompanyStatus; portfolio_group: string[] | null }[] | null
    }

  const companyMap = new Map((companies ?? []).map(c => [c.id, c]))

  // -- all transactions for the fund --
  const { data: allTxns } = await admin
    .from('investment_transactions' as any)
    .select('*')
    .eq('fund_id', fundId)
    .order('transaction_date', { ascending: true }) as { data: InvestmentTransaction[] | null }

  if (!allTxns || allTxns.length === 0) return NextResponse.json({ series: [] })

  // -- filter to transactions that belong to the requested group --
  // mirrors investments/route.ts: group = txn.portfolio_group ?? company.portfolio_group[0] ?? ''
  const txns = allTxns.filter(txn => {
    const company = companyMap.get(txn.company_id)
    const txnGroup = txn.portfolio_group ?? company?.portfolio_group?.[0] ?? ''
    return txnGroup === group
  })

  if (txns.length === 0) return NextResponse.json({ series: [] })

  // -- find first investment date to anchor the chart --
  const firstInvestment = txns.find(t => t.transaction_type === 'investment' && t.transaction_date)
  if (!firstInvestment) return NextResponse.json({ series: [] })

  const startYM = toYM(firstInvestment.transaction_date!)
  const nowYM   = toYM(new Date().toISOString().split('T')[0])
  const months  = monthRange(startYM, nowYM)

  // ---------------------------------------------------------------------------
  // For each month-end snapshot, replay all transactions up to that cutoff
  // exactly like investments/route.ts does for the terminal snapshot — but we
  // do it for every month so we get a time-series.
  // ---------------------------------------------------------------------------
  const series: DataPoint[] = []

  for (const ym of months) {
    const cutoff     = lastDayOfMonth(ym)
    const cutoffDate = new Date(cutoff)
    const pastTxns   = txns.filter(t => t.transaction_date != null && t.transaction_date <= cutoff)

    // Per-company state at this cutoff
    type CompanyState = {
      totalInvested: number
      totalShares: number
      totalRealized: number
      latestSharePrice: number | null
      latestValuation: number | null
      latestOwnership: number | null
      explicitNav: number | null         // from unrealized_gain_change or proceeds
      unrealizedDelta: number            // sum of unrealized_value_change via roundMap
      costBasisExited: number
      roundMap: Map<string, { investmentCost: number; sharesAcquired: number; unrealizedDelta: number; costBasisExited: number }>
    }

    const stateMap = new Map<string, CompanyState>()

    for (const txn of pastTxns) {
      const cid = txn.company_id
      if (!stateMap.has(cid)) {
        stateMap.set(cid, {
          totalInvested: 0, totalShares: 0, totalRealized: 0,
          latestSharePrice: null, latestValuation: null, latestOwnership: null,
          explicitNav: null, unrealizedDelta: 0, costBasisExited: 0,
          roundMap: new Map(),
        })
      }
      const s = stateMap.get(cid)!

      if (txn.transaction_type === 'investment') {
        s.totalInvested += txn.investment_cost ?? 0
        s.totalShares   += txn.shares_acquired ?? 0
        if (txn.share_price && txn.share_price > 0) s.latestSharePrice = txn.share_price
        if (txn.postmoney_valuation != null)         s.latestValuation  = txn.postmoney_valuation
        if (txn.ownership_pct != null)               s.latestOwnership  = txn.ownership_pct

        const rn = txn.round_name ?? 'Unknown'
        const r  = s.roundMap.get(rn) ?? { investmentCost: 0, sharesAcquired: 0, unrealizedDelta: 0, costBasisExited: 0 }
        r.investmentCost += txn.investment_cost ?? 0
        r.sharesAcquired += txn.shares_acquired ?? 0
        s.roundMap.set(rn, r)
      }

      if (txn.transaction_type === 'proceeds') {
        const amt = (txn.proceeds_received ?? 0) + (txn.proceeds_escrow ?? 0)
        s.totalRealized += amt
        if (txn.cost_basis_exited != null) s.costBasisExited += Math.abs(txn.cost_basis_exited)
        if (txn.exit_valuation != null)    s.latestValuation  = txn.exit_valuation
        if (txn.ownership_pct != null)     s.latestOwnership  = txn.ownership_pct
        // explicit residual nav after exit
        s.explicitNav = txn.unrealized_value_change ?? 0

        if (txn.round_name && txn.cost_basis_exited != null) {
          const r = s.roundMap.get(txn.round_name)
          if (r) r.costBasisExited += Math.abs(txn.cost_basis_exited)
        }
      }

      if (txn.transaction_type === 'unrealized_gain_change') {
        if (txn.current_share_price != null)          s.latestSharePrice = txn.current_share_price
        if (txn.latest_postmoney_valuation != null)   s.latestValuation  = txn.latest_postmoney_valuation
        if (txn.ownership_pct != null)                s.latestOwnership  = txn.ownership_pct
        if (txn.unrealized_value_change != null)      s.explicitNav      = txn.unrealized_value_change

        if (txn.round_name && txn.unrealized_value_change != null) {
          const r = s.roundMap.get(txn.round_name)
          if (r) r.unrealizedDelta += txn.unrealized_value_change
        }
      }

      if (txn.transaction_type === 'round_info') {
        if (txn.share_price != null)          s.latestSharePrice = txn.share_price
        if (txn.postmoney_valuation != null)  s.latestValuation  = txn.postmoney_valuation
        if (txn.ownership_pct != null)        s.latestOwnership  = txn.ownership_pct
      }
    }

    // -- aggregate across companies --
    let totalInvested   = 0
    let totalRealized   = 0
    let totalUnrealized = 0
    const cashFlows: CashFlow[] = []

    for (const [cid, s] of stateMap.entries()) {
      const company = companyMap.get(cid)
      const sumUnrDelta = [...s.roundMap.values()].reduce((acc, r) => acc + r.unrealizedDelta, 0)
      const uv = calcUnrealized(
        company?.status ?? null,
        s.explicitNav,
        s.latestOwnership,
        s.latestValuation,
        s.latestSharePrice,
        s.totalShares,
        s.totalInvested,
        sumUnrDelta,
        s.costBasisExited,
      )
      totalInvested   += s.totalInvested
      totalRealized   += s.totalRealized
      totalUnrealized += uv
    }

    if (totalInvested <= 0) continue

    // -- NAV index (base 100) --
    const nav = parseFloat((((totalUnrealized + totalRealized) / totalInvested) * 100).toFixed(2))

    // -- rolling XIRR: investments as negative CFs, proceeds as positive CFs,
    //    current NAV (unrealized) as terminal positive CF at cutoff date --
    for (const txn of pastTxns) {
      if (txn.transaction_type === 'investment' && txn.investment_cost && txn.transaction_date) {
        cashFlows.push({ date: new Date(txn.transaction_date), amount: -(txn.investment_cost) })
      }
      if (txn.transaction_type === 'proceeds' && txn.transaction_date) {
        const amt = (txn.proceeds_received ?? 0) + (txn.proceeds_escrow ?? 0)
        if (amt > 0) cashFlows.push({ date: new Date(txn.transaction_date), amount: amt })
      }
    }

    let irr: number | null = null
    if (cashFlows.length > 0 && (totalUnrealized > 0 || totalRealized > 0)) {
      const flowsWithTerminal = [
        ...cashFlows,
        ...(totalUnrealized > 0 ? [{ date: cutoffDate, amount: totalUnrealized }] : []),
      ]
      try { irr = xirr(flowsWithTerminal) } catch { irr = null }
    }

    series.push({ date: cutoff, nav, irr })
  }

  return NextResponse.json({ series, latestValue: series.at(-1)?.nav ?? null })
}
