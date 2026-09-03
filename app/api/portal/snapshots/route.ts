import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveLpAccess } from '@/lib/api-helpers'

/**
 * LP portal — the signed-in LP's statements. Frozen snapshots are retired: this returns the LIVE
 * capital statement (always current) for each enabled fund whose live report is published to the
 * LP. Scoped strictly to their investor rows via resolveLpAccess; never consults fund_members.
 */
export async function GET() {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse) return access
  const { investorIds } = access
  if (investorIds.length === 0) return NextResponse.json({ snapshots: [] })

  // The live report published to this LP (lp_live_report_shares), for funds with the portal on.
  const { data: liveShares } = await (admin as any)
    .from('lp_live_report_shares').select('fund_id').in('lp_investor_id', investorIds)
  const shareFundIds = Array.from(new Set(((liveShares ?? []) as any[]).map(s => s.fund_id as string)))
  let enabledFunds = new Set<string>()
  if (shareFundIds.length) {
    const { data: ef } = await (admin as any)
      .from('fund_settings').select('fund_id').eq('lp_portal_enabled', true).in('fund_id', shareFundIds)
    enabledFunds = new Set((ef ?? []).map((f: any) => f.fund_id as string))
  }
  const liveFundIds = shareFundIds.filter(f => enabledFunds.has(f))
  const live = liveFundIds.map(fundId => ({
    id: `live:${fundId}`,
    name: 'Capital Statement',
    as_of_date: null as string | null,
    shared_at: '',
    last_viewed_at: null as string | null,
    viewHref: '/portal/overview' as string | null,
    pdfUrl: `/api/portal/statement/pdf?fund=${fundId}` as string | null,
  }))

  return NextResponse.json({ snapshots: live })
}
