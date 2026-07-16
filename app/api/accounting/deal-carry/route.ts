// GET ?group=X — deal-by-deal (American) carry for a vehicle.
//
// For each company the vehicle holds, its total invested / realized / remaining value comes from
// the portfolio tracker (the source of truth for exits — the ledger pools realized gains), and
// `dealByDealCarry` computes the GP's per-deal carry entitlement: carry on each deal's gain over
// its fully-loaded cost (cost basis + its share of fund expenses). This is the EARLY entitlement
// an American waterfall pays as deals realize; the whole-fund clawback (carry paid vs. accrued) is
// surfaced separately on the GP panel.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { loadCarryTerms } from '@/lib/accounting/carry'
import { loadCapitalPostings } from '@/lib/accounting/capital-source'
import { computeCapitalAccounts } from '@/lib/accounting/capital-account'
import { txnsForVehicle } from '@/lib/accounting/soi'
import { computeSummary } from '@/lib/investments'
import { dealByDealCarry, type DealResult } from '@/lib/accounting/american-carry'
import { roundCents } from '@/lib/accounting/ledger'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const terms = await loadCarryTerms(admin, gate.fundId, group)

  const [{ data: txns }, { data: companies }, capital] = await Promise.all([
    admin.from('investment_transactions' as any).select('*').eq('fund_id', gate.fundId),
    admin.from('companies' as any).select('id, name, status').eq('fund_id', gate.fundId),
    // Fund expenses allocated across deals: total the durable managementFees + expenses buckets on
    // the capital accounts (the P&L accounts get zeroed at close, these persist). 0 if not on a ledger.
    loadCapitalPostings(admin, gate.fundId, group).catch(() => null),
  ])

  const allTxns = (txns as any[]) ?? []
  const byCompany = new Map<string, any[]>()
  for (const t of allTxns) {
    const list = byCompany.get(t.company_id) ?? []
    list.push(t)
    byCompany.set(t.company_id, list)
  }

  const deals: DealResult[] = []
  for (const c of ((companies as any[]) ?? [])) {
    const relevant = txnsForVehicle(byCompany.get(c.id) ?? [], group)
    if (!relevant.some(t => t.transaction_type === 'investment' && t.portfolio_group === group)) continue
    const s = computeSummary(relevant, c.status)
    if (s.totalInvested <= 0) continue
    deals.push({
      companyId: c.id,
      name: c.name,
      costBasis: roundCents(s.totalInvested),
      proceeds: roundCents(s.totalRealized),
      remainingValue: roundCents(s.unrealizedValue),
    })
  }

  const totalExpenses = capital
    ? roundCents(-Array.from(computeCapitalAccounts(capital.postings).values()).reduce((sum, a) => sum + a.managementFees + a.expenses, 0))
    : 0

  const result = dealByDealCarry(deals, { carryRate: terms.carryRate, totalExpenses })

  return NextResponse.json({
    group,
    kind: terms.kind,
    carryRate: terms.carryRate,
    ...result,
  })
}
