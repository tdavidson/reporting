import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertReadAccess } from '@/lib/api-helpers'
import { fundEconomics } from '@/lib/accounting/fund-economics'

// Fund-level performance per vehicle, derived from the ledger.
//
// FUND-WIDE — it reports every vehicle, so there is no `group` to resolve. `asOf` is a real
// as-of: the terminal value in the IRR lands on that date, not on today.

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const asOf = req.nextUrl.searchParams.get('asOf') ?? undefined
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return NextResponse.json({ error: 'asOf must be YYYY-MM-DD' }, { status: 400 })
  }

  try {
    return NextResponse.json({ asOf: asOf ?? null, vehicles: await fundEconomics(admin, gate.fundId, asOf) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
