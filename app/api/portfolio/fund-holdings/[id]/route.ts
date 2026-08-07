import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// portfolio domain, investments feature (lib/access/route-domains.ts).
import { assertReadAccess, assertWriteAccess } from '@/lib/api-helpers'

// One fund holding and its terms.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const [holding, terms, events, navs] = await Promise.all([
    admin.from('companies').select('id, name, holding_type')
      .eq('id', params.id).eq('fund_id', gate.fundId).maybeSingle(),
    (admin as any).from('fund_holding_terms').select('*')
      .eq('company_id', params.id).eq('fund_id', gate.fundId).maybeSingle(),
    (admin as any).from('fund_capital_events').select('*')
      .eq('company_id', params.id).eq('fund_id', gate.fundId).order('event_date'),
    (admin as any).from('fund_nav_statements').select('*')
      .eq('company_id', params.id).eq('fund_id', gate.fundId).order('as_of_date', { ascending: false }),
  ])

  if (!holding.data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({
    holding: holding.data,
    terms: terms.data ?? null,
    events: events.data ?? [],
    navStatements: navs.data ?? [],
  })
}

const TERM_FIELDS: Record<string, string> = {
  managerName: 'manager_name',
  vintageYear: 'vintage_year',
  fundSize: 'fund_size',
  strategy: 'strategy',
  geography: 'geography',
  commitment: 'commitment',
  commitmentDate: 'commitment_date',
  finalCloseDate: 'final_close_date',
  termEndDate: 'term_end_date',
  notes: 'notes',
}

// PATCH — the terms. Upsert, because a holding created outside this route (QuickBooks
// discovery, an import) may have no terms row yet.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const patch: Record<string, unknown> = {}
  for (const [key, column] of Object.entries(TERM_FIELDS)) {
    if (key in body) patch[column] = body[key]
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No recognized fields to update' }, { status: 400 })
  }

  const { error } = await (admin as any).from('fund_holding_terms').upsert({
    fund_id: gate.fundId,
    company_id: params.id,
    ...patch,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'company_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

// DELETE — the holding, cascading its terms, register and NAV statements.
//
// REFUSED once anything has posted. A register row carrying an investment_transaction_id is
// represented in the ledger; deleting the holding behind the ledger's back leaves postings
// referencing a holding that no longer exists.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const { count } = await (admin as any)
    .from('fund_capital_events')
    .select('id', { count: 'exact', head: true })
    .eq('fund_id', gate.fundId)
    .eq('company_id', params.id)
    .not('investment_transaction_id', 'is', null)

  if ((count ?? 0) > 0) {
    return NextResponse.json({
      error: `This holding has ${count} confirmed event(s) posted to the ledger. `
           + `Reverse those entries before deleting the holding.`,
    }, { status: 409 })
  }

  const { count: navCount } = await (admin as any)
    .from('fund_nav_statements')
    .select('id', { count: 'exact', head: true })
    .eq('fund_id', gate.fundId)
    .eq('company_id', params.id)
    .not('investment_transaction_id', 'is', null)
  if ((navCount ?? 0) > 0) {
    return NextResponse.json({
      error: `This holding has ${navCount} posted valuation mark(s). Reverse them before deleting.`,
    }, { status: 409 })
  }

  const { error } = await admin
    .from('companies').delete().eq('id', params.id).eq('fund_id', gate.fundId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
