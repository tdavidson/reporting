import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { rateLimit } from '@/lib/rate-limit'
import { buildStatementPackage } from '@/lib/accounting/statement-package'
import { buildStatementWorkbook } from '@/lib/accounting/statement-workbook'

// GET — the statement package as a multi-tab .xlsx workpaper. Same params, same
// gating, and the SAME computed package as /api/accounting/statements — this route
// only changes the serialization (workbook instead of JSON).
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  // Building a workbook is heavier than the JSON path; cap it like the LP export.
  const limited = await rateLimit({ key: `statements-export:${user.id}`, limit: 20, windowSeconds: 300 })
  if (limited) return limited

  const [pkg, { data: fund }] = await Promise.all([
    buildStatementPackage(admin, gate.fundId, group, req.nextUrl.searchParams),
    admin.from('funds').select('name').eq('id', gate.fundId).maybeSingle() as unknown as Promise<{ data: { name: string } | null }>,
  ])

  const wb = buildStatementWorkbook(pkg, {
    fundName: fund?.name ?? 'Fund',
    vehicle: group,
    generatedAt: new Date().toISOString(),
  })
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  const asOf = pkg.payload.period.end ?? new Date().toISOString().split('T')[0]
  const filename = `workpapers-${group}-${asOf}`.replace(/[^a-zA-Z0-9\-]/g, '-')
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
    },
  })
}
