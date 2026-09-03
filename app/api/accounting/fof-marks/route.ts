import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts).
import { assertReadAccess, assertWriteAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { loadPostedLedger } from '@/lib/accounting/load'
import { draftEntryForTransaction } from '@/lib/accounting/from-portfolio'
import { loadFofData, ledgerCarryingByHolding } from '@/lib/portfolio/fof-load'
import { periodEndMarks, valuationBasisNote } from '@/lib/portfolio/fof-valuation'

/**
 * The period-end marks a fund of funds still owes, and the action that books them.
 *
 * The mark is DERIVED AT CLOSE rather than when a NAV is entered: a manager statement arrives
 * mid-quarter, and a call notice for the same fund can land a week later dated before period
 * end. A mark computed at entry time would be stale the moment that call arrives. Recomputing
 * the whole position here makes the order of arrival irrelevant.
 */
async function marksFor(admin: any, fundId: string, group: string, asOf: string) {
  const [fof, ledger] = await Promise.all([
    loadFofData(admin, fundId, asOf),
    loadPostedLedger(admin, fundId, group, asOf),
  ])
  const carrying = ledgerCarryingByHolding(ledger.accounts, ledger.postings)
  return {
    marks: periodEndMarks(fof.positions, carrying, asOf),
    valuationNote: valuationBasisNote(fof.positions),
  }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const asOf = req.nextUrl.searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10)

  const { marks, valuationNote } = await marksFor(admin, gate.fundId, group, asOf)
  return NextResponse.json({ asOf, marks, valuationNote })
}

// POST — book every pending mark as an unrealized_gain_change, drafting its ledger entry.
// This is the action that clears the close blocker.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? null)
  if (group instanceof NextResponse) return group
  const asOf = typeof body?.asOf === 'string' ? body.asOf : new Date().toISOString().slice(0, 10)

  const { marks } = await marksFor(admin, gate.fundId, group, asOf)

  let booked = 0
  const errors: string[] = []
  for (const m of marks) {
    const { data: txn, error } = await (admin as any)
      .from('investment_transactions')
      .insert({
        fund_id: gate.fundId,
        company_id: m.companyId,
        transaction_type: 'unrealized_gain_change',
        transaction_date: asOf,
        unrealized_value_change: m.delta,
        portfolio_group: group,
      })
      .select('id, company_id, transaction_type, transaction_date, unrealized_value_change, portfolio_group')
      .single()
    if (error || !txn) { errors.push(`${m.name}: ${error?.message ?? 'insert failed'}`); continue }

    const drafted = await draftEntryForTransaction(admin, gate.fundId, user.id, txn, m.name)
    if ((drafted as any)?.skipped) errors.push(`${m.name}: ${(drafted as any).skipped}`)
    booked += 1
  }

  return NextResponse.json({ asOf, booked, total: marks.length, errors })
}
