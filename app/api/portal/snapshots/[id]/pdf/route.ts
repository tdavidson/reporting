import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveLpAccess } from '@/lib/api-helpers'
import { logLpAccessEvent } from '@/lib/lp-access-log'
import { generateInvestorReportPdf } from '@/lib/lp-report-pdf'

export const maxDuration = 120

/**
 * LP portal — download the LP's snapshot report as a PDF. Isolation: the
 * snapshot must be shared with one of the signed-in LP's investors, the fund's
 * portal must be on, and the report is scoped to that LP's own investor slice.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse) return access
  const { investorIds, lpAccountId } = access
  const snapshotId = params.id
  if (investorIds.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: shares } = await (admin as any)
    .from('lp_snapshot_shares').select('lp_investor_id, fund_id').eq('snapshot_id', snapshotId).in('lp_investor_id', investorIds)
  const sharedInvestorIds = Array.from(new Set((shares ?? []).map((s: any) => s.lp_investor_id as string))) as string[]
  if (sharedInvestorIds.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const fundId = (shares as any[])[0].fund_id as string

  const { data: ef } = await (admin as any).from('fund_settings').select('lp_portal_enabled').eq('fund_id', fundId).maybeSingle()
  if (!ef?.lp_portal_enabled) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const result = await generateInvestorReportPdf(admin, { fundId, snapshotId, investorIds: sharedInvestorIds })
  if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await logLpAccessEvent(admin, {
    fundId,
    lpAccountId,
    authUserId: user.id,
    lpInvestorId: sharedInvestorIds[0] ?? null,
    eventType: 'download',
    targetType: 'snapshot',
    targetId: snapshotId,
    targetTitle: result.fileName,
    metadata: { investor_ids: sharedInvestorIds, format: 'pdf' },
  })

  return new NextResponse(new Uint8Array(result.pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${result.fileName}"` },
  })
}
