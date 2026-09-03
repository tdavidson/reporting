import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts). The middleware has already checked the grant.
import { assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { loadPostedLedger } from '@/lib/accounting/load'
import { accountBalances } from '@/lib/accounting/ledger'
import { loadFofData } from '@/lib/portfolio/fof-load'
import { valuationBasisNote } from '@/lib/portfolio/fof-valuation'
import { fofSoiPositions, commitmentSchedule, performanceTable } from '@/lib/portfolio/fof-exhibits'

/**
 * All three fund-of-funds exhibits, from ONE load and ONE computation.
 *
 * Three routes would mean three loads and three chances for the exhibits on a single page to
 * disagree with each other about a partner's unfunded commitment.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const group = await resolveGroupOr400(admin, gate, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const asOf = req.nextUrl.searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10)

  const [fof, ledger] = await Promise.all([
    loadFofData(admin, gate.fundId, asOf),
    loadPostedLedger(admin, gate.fundId, group, asOf),
  ])

  // The positions' OWN total, not the balance-sheet NAV: the SOI's percent-of-NAV column has
  // to sum to 100%, and a fund holding cash would otherwise make it sum to less with no
  // explanation on the page.
  const totalNav = fof.positions.reduce((a, p) => a + p.carryingValue, 0)

  // Cash for the coverage ratio. Zero cash against real unfunded commitment is a real answer,
  // so an absent cash account reports 0 rather than suppressing the ratio.
  const balances = accountBalances(ledger.postings)
  const cash = ledger.accounts
    .filter(a => a.subtype === 'cash')
    .reduce((a, acct) => a + (balances.get(acct.id) ?? 0), 0)

  return NextResponse.json({
    asOf,
    group,
    totalNav,
    cash,
    soi: fofSoiPositions(fof.positions, totalNav),
    commitments: commitmentSchedule(fof.positions, cash),
    performance: performanceTable(fof.positions),
    valuationNote: valuationBasisNote(fof.positions),
  })
}
