import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbError } from '@/lib/api-error'

/**
 * Queue external web research for an inbound deal on demand.
 *
 * Automatic research only runs for deals that clear the fund's interest bar
 * (thesis fit ≥ deal_research_min_fit). This endpoint is the manual override:
 * a partner who finds a low-scored deal interesting anyway can ask for research
 * explicitly. That is a deliberate human decision to spend the money, so it
 * bypasses the fit gate — but not the enabled flag.
 */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  const fundId = (membership as any).fund_id as string

  const { data: settings } = await (admin as any)
    .from('fund_settings')
    .select('deal_research_enabled')
    .eq('fund_id', fundId)
    .maybeSingle()

  if (!(settings as any)?.deal_research_enabled) {
    return NextResponse.json(
      { error: 'External deal research is turned off for this fund. Enable it in Settings → Deals.' },
      { status: 400 }
    )
  }

  const { data: deal } = await (admin as any)
    .from('inbound_deals')
    .select('id, research_status')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const status = (deal as any).research_status as string | null
  if (status === 'pending' || status === 'running') {
    return NextResponse.json({ queued: true, already: true, research_status: status })
  }

  const { error } = await (admin as any)
    .from('inbound_deals')
    .update({ research_status: 'pending', research_error: null })
    .eq('id', params.id)
    .eq('fund_id', fundId)

  if (error) return dbError(error, 'deals-id-research')

  // The cron picks it up within ~10 minutes; no kick needed since research is
  // not latency-sensitive the way an interactive agent stage is.
  return NextResponse.json({ queued: true, research_status: 'pending' })
}
