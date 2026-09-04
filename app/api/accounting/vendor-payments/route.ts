import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts). Read-only.
import { assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { loadVendorPayments } from '@/lib/accounting/vendor-payments-load'

// GET ?group=&year=YYYY — cash paid per vendor on this vehicle's books in the year: the 1099
// worksheet. Eligible vendors at or above the threshold are marked reportable; those without a
// TIN on file are the rows to chase for a W-9.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const sp = req.nextUrl.searchParams
  const group = await resolveGroupOr400(admin, gate, sp.get('group'))
  if (group instanceof NextResponse) return group

  const year = parseInt(sp.get('year') ?? '', 10)
  if (!Number.isInteger(year)) return NextResponse.json({ error: 'year=YYYY is required' }, { status: 400 })

  return NextResponse.json({ year, ...(await loadVendorPayments(admin, gate.fundId, group, year)) })
}
