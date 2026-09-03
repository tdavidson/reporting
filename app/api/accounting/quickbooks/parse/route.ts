import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts). The middleware has already checked the grant.
import { assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { parseQbJournal } from '@/lib/accounting/quickbooks/parse-journal'
import { proposeMapping, type ChartAccount } from '@/lib/accounting/quickbooks/propose-mapping'

/**
 * Step 1 of the migration: read a QuickBooks Journal export and propose a mapping.
 *
 * WRITES NOTHING. The user reviews the parse errors and the proposals before any import runs,
 * which is the point — a confident wrong mapping misstates a whole account for years.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  if (typeof body?.text !== 'string' || !body.text.trim()) {
    return NextResponse.json({ error: 'Paste or upload the Journal export first.' }, { status: 400 })
  }

  const group = await resolveGroupOr400(admin, gate, body?.group ?? null)
  if (group instanceof NextResponse) return group
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)

  const { transactions, accounts, errors } = parseQbJournal(body.text)

  const [{ data: chartRows }, { data: savedRows }] = await Promise.all([
    admin.from('chart_of_accounts' as any)
      .select('id, code, name, type, subtype')
      .eq('fund_id', gate.fundId).eq('vehicle_id', vehicleId),
    (admin as any).from('qb_account_mappings')
      .select('qb_account, account_code, excluded')
      .eq('fund_id', gate.fundId).eq('vehicle_id', vehicleId),
  ])

  const chart = ((chartRows as any[]) ?? []) as ChartAccount[]
  const saved = new Map(((savedRows as any[]) ?? []).map(r => [r.qb_account, r]))

  // A previously CONFIRMED mapping always wins over a fresh proposal — see the migration's
  // comment on why re-proposing between passes would move balances for no visible reason.
  const proposals = proposeMapping(accounts, chart).map(p => {
    const prior = saved.get(p.qbAccount)
    if (!prior) return p
    return {
      ...p,
      code: prior.account_code ?? null,
      excluded: !!prior.excluded,
      confidence: 'exact' as const,
      reason: prior.excluded ? 'Excluded from import (saved).' : 'Confirmed previously.',
    }
  })

  const dates = transactions.map(t => t.date).sort()

  return NextResponse.json({
    group,
    transactionCount: transactions.length,
    dateRange: dates.length ? { first: dates[0], last: dates[dates.length - 1] } : null,
    accounts: proposals,
    mappedCount: proposals.filter((p: any) => p.code && !p.excluded).length,
    excludedCount: proposals.filter((p: any) => p.excluded).length,
    discoveredHoldings: Array.from(new Set(proposals.map(p => p.suggestsHolding).filter(Boolean))),
    errors,
  })
}
