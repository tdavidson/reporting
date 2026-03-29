import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { InvestmentTransaction } from '@/lib/types/database'

// Returns monthly NAV index (base 100) for a portfolio group
// NAV at month M = (sum of unrealized value + cumulative proceeds) / total invested * 100

interface DataPoint { date: string; value: number }

function toYearMonth(dateStr: string): string {
  return dateStr.slice(0, 7) // YYYY-MM
}

function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m, 0) // day 0 of next month = last day of this month
  return d.toISOString().split('T')[0]
}

function monthRange(startYM: string, endYM: string): string[] {
  const months: string[] = []
  const [sy, sm] = startYM.split('-').map(Number)
  const [ey, em] = endYM.split('-').map(Number)
  let y = sy, m = sm
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return months
}

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

  // Fetch all investment_transactions for this group
  const { data: companies } = await admin
    .from('companies')
    .select('id, status, portfolio_group')
    .eq('fund_id', fundId)

  const companyIds = (companies ?? []).filter(c => {
    const groups: string[] = c.portfolio_group ?? []
    return group === '' || groups.includes(group) || groups[0] === group
  }).map(c => c.id)

  if (companyIds.length === 0) return NextResponse.json({ series: [], latestValue: null })

  const companyStatusMap = new Map((companies ?? []).map(c => [c.id, c.status]))

  const { data: txns } = await admin
    .from('investment_transactions' as any)
    .select('*')
    .eq('fund_id', fundId)
    .in('company_id', companyIds)
    .order('transaction_date', { ascending: true }) as { data: InvestmentTransaction[] | null }

  if (!txns || txns.length === 0) return NextResponse.json({ series: [], latestValue: null })

  // Find date range
  const allDates = txns.map(t => t.transaction_date).filter(Boolean) as string[]
  if (allDates.length === 0) return NextResponse.json({ series: [], latestValue: null })
  const startYM = toYearMonth(allDates[0])
  const nowYM = toYearMonth(new Date().toISOString().split('T')[0])
  const months = monthRange(startYM, nowYM)

  // For each month-end, compute: totalInvested, cumulativeProceeds, unrealizedValue
  const series: DataPoint[] = []

  for (const ym of months) {
    const cutoff = lastDayOfMonth(ym)
    const pastTxns = txns.filter(t => t.transaction_date != null && t.transaction_date <= cutoff)

    let totalInvested = 0
    let cumulativeProceeds = 0

    // Per-company state
    const companyState = new Map<string, {
      totalInvested: number
      totalShares: number
      unrealizedValue: number
      totalRealized: number
      latestSharePrice: number | null
      latestValuation: number | null
      latestOwnership: number | null
      explicitNav: number | null
    }>()

    for (const txn of pastTxns) {
      const cid = txn.company_id
      if (!companyState.has(cid)) {
        companyState.set(cid, {
          totalInvested: 0, totalShares: 0, unrealizedValue: 0, totalRealized: 0,
          latestSharePrice: null, latestValuation: null, latestOwnership: null, explicitNav: null,
        })
      }
      const s = companyState.get(cid)!

      if (txn.transaction_type === 'investment') {
        s.totalInvested += txn.investment_cost ?? 0
        s.totalShares += txn.shares_acquired ?? 0
        if (txn.share_price && txn.share_price > 0) s.latestSharePrice = txn.share_price
        if (txn.postmoney_valuation) s.latestValuation = txn.postmoney_valuation
        if (txn.ownership_pct != null) s.latestOwnership = txn.ownership_pct
      }
      if (txn.transaction_type === 'proceeds') {
        const amt = (txn.proceeds_received ?? 0) + (txn.proceeds_escrow ?? 0)
        s.totalRealized += amt
        if (txn.exit_valuation) s.latestValuation = txn.exit_valuation
        if (txn.unrealized_value_change != null) s.explicitNav = txn.unrealized_value_change
        else s.explicitNav = 0
      }
      if (txn.transaction_type === 'unrealized_gain_change') {
        if (txn.current_share_price != null) s.latestSharePrice = txn.current_share_price
        if (txn.latest_postmoney_valuation != null) s.latestValuation = txn.latest_postmoney_valuation
        if (txn.ownership_pct != null) s.latestOwnership = txn.ownership_pct
        if (txn.unrealized_value_change != null) s.explicitNav = txn.unrealized_value_change
      }
      if (txn.transaction_type === 'round_info') {
        if (txn.share_price != null) s.latestSharePrice = txn.share_price
        if (txn.postmoney_valuation != null) s.latestValuation = txn.postmoney_valuation
        if (txn.ownership_pct != null) s.latestOwnership = txn.ownership_pct
      }
    }

    // Aggregate
    let totalUnrealized = 0
    for (const [cid, s] of companyState.entries()) {
      totalInvested += s.totalInvested
      cumulativeProceeds += s.totalRealized

      const status = companyStatusMap.get(cid)
      let uv = 0
      if (status === 'written-off') {
        uv = 0
      } else if (s.explicitNav != null) {
        uv = Math.max(0, s.explicitNav)
      } else if (s.latestOwnership != null && s.latestValuation != null) {
        uv = (s.latestOwnership / 100) * s.latestValuation
      } else if (s.latestSharePrice != null && s.totalShares > 0) {
        uv = s.latestSharePrice * s.totalShares
      } else {
        uv = s.totalInvested // cost basis as fallback
      }
      totalUnrealized += uv
    }

    if (totalInvested <= 0) continue

    // NAV index = (unrealized + proceeds) / invested * 100
    const nav = ((totalUnrealized + cumulativeProceeds) / totalInvested) * 100
    series.push({ date: cutoff, value: parseFloat(nav.toFixed(2)) })
  }

  return NextResponse.json({
    series,
    latestValue: series.at(-1)?.value ?? null,
  })
}
