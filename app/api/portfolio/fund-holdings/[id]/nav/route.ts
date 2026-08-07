import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// portfolio domain, investments feature (lib/access/route-domains.ts).
import { assertReadAccess, assertWriteAccess } from '@/lib/api-helpers'

const BASES = ['final', 'preliminary', 'estimate']

// Manager NAV statements for one fund holding, newest valuation date first.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const { data } = await (admin as any)
    .from('fund_nav_statements').select('*')
    .eq('fund_id', gate.fundId).eq('company_id', params.id)
    .order('as_of_date', { ascending: false })
  return NextResponse.json({ navStatements: data ?? [] })
}

// POST — record a manager statement.
// { asOfDate, reportedNav, basis?, receivedDate?, vehicleId?,
//   reportedContributions?, reportedDistributions?, reportedUnfunded? }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  if (typeof body?.asOfDate !== 'string') {
    return NextResponse.json({ error: 'asOfDate is required' }, { status: 400 })
  }
  const reportedNav = Number(body?.reportedNav)
  if (!Number.isFinite(reportedNav)) {
    return NextResponse.json({ error: 'reportedNav must be a number' }, { status: 400 })
  }

  // UPSERT on (company_id, as_of_date): a corrected statement REPLACES the one we had for
  // that valuation date. A second row would win or lose by insertion order, which is not a
  // property anyone should have to reason about when reading a NAV.
  //
  // Deliberately does NOT clear investment_transaction_id. If the original already posted, a
  // restatement needs a correcting mark — until then the link is the honest record of what
  // was posted, not something to quietly orphan.
  const { error } = await (admin as any)
    .from('fund_nav_statements')
    .upsert({
      fund_id: gate.fundId,
      vehicle_id: body?.vehicleId ?? null,
      company_id: params.id,
      as_of_date: body.asOfDate,
      received_date: body?.receivedDate ?? null,
      reported_nav: reportedNav,
      basis: BASES.includes(body?.basis) ? body.basis : 'final',
      reported_contributions: body?.reportedContributions ?? null,
      reported_distributions: body?.reportedDistributions ?? null,
      reported_unfunded: body?.reportedUnfunded ?? null,
      source: 'manual',
      created_by: user.id,
    }, { onConflict: 'company_id,as_of_date' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
