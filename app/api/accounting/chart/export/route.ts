import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts).
import { assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { loadChartForExport } from '@/lib/accounting/journal-export-load'
import { chartRows } from '@/lib/accounting/journal-export'
import { toCsv } from '@/lib/accounting/csv'

// GET — the vehicle's chart of accounts as CSV: code, name, type, subtype, normal side, active,
// and the partner or company a per-entity account belongs to.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const accounts = await loadChartForExport(admin, gate.fundId, group)
  const filename = `chart-of-accounts-${group}`.replace(/[^a-zA-Z0-9\-]/g, '-')
  return new NextResponse(toCsv(chartRows(accounts)), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.csv"`,
    },
  })
}
