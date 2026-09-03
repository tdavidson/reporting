import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveLpAccess } from '@/lib/api-helpers'
import { generateLiveInvestorReportPdf } from '@/lib/lp-report-pdf'

export const maxDuration = 120

/**
 * LP portal — the signed-in LP's LIVE capital statement as a PDF (derived, as-of-today), for a
 * fund whose live report has been published to them (lp_live_report_shares) and whose portal is
 * on. Replaces the frozen-snapshot statement download. Scoped strictly to their own investors.
 *
 *   GET ?fund=<fundId>
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse) return access
  const { investorIds } = access
  if (investorIds.length === 0) return NextResponse.json({ error: 'No access' }, { status: 403 })

  const fundId = req.nextUrl.searchParams.get('fund') ?? ''
  if (!fundId) return NextResponse.json({ error: 'fund is required' }, { status: 400 })

  // The live report must be PUBLISHED to this LP for this fund, and the portal must be on.
  const [{ data: shares }, { data: fs }] = await Promise.all([
    (admin as any).from('lp_live_report_shares').select('lp_investor_id').eq('fund_id', fundId).in('lp_investor_id', investorIds),
    (admin as any).from('fund_settings').select('lp_portal_enabled').eq('fund_id', fundId).maybeSingle(),
  ])
  const sharedInvestorIds = Array.from(new Set(((shares ?? []) as any[]).map(s => s.lp_investor_id as string)))
  if (sharedInvestorIds.length === 0 || !fs?.lp_portal_enabled) {
    return NextResponse.json({ error: 'Statement not available' }, { status: 404 })
  }

  const result = await generateLiveInvestorReportPdf(admin, { fundId, investorIds: sharedInvestorIds })
  if (!result) return NextResponse.json({ error: 'No statement data' }, { status: 404 })

  return new NextResponse(new Uint8Array(result.pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${result.fileName}"`,
    },
  })
}
