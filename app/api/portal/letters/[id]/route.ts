import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveLpAccess } from '@/lib/api-helpers'
import { logLpAccessEvent } from '@/lib/lp-access-log'
import { sanitizeLetterHtml } from '@/lib/sanitize'

/**
 * LP portal — one shared, finalized LP letter. Isolation: resolveLpAccess →
 * the letter must be shared with one of the LP's investors → the fund's portal
 * must be on → the letter must be final.
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
  const letterId = params.id
  if (investorIds.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: shares } = await (admin as any)
    .from('lp_letter_shares')
    .select('lp_investor_id, fund_id')
    .eq('letter_id', letterId)
    .in('lp_investor_id', investorIds)
  if (!shares || shares.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const sharedInvestorIds = Array.from(new Set(shares.map((s: any) => s.lp_investor_id as string))) as string[]

  const fundId = shares[0].fund_id as string
  const { data: ef } = await (admin as any).from('fund_settings').select('lp_portal_enabled').eq('fund_id', fundId).maybeSingle()
  if (!ef?.lp_portal_enabled) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: letter } = await (admin as any)
    .from('lp_letters')
    .select('id, period_label, status, full_draft, portfolio_table_html, company_narratives')
    .eq('id', letterId)
    .maybeSingle()
  if (!letter || letter.status === 'generating') return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Defense-in-depth: scrub the GP-authored HTML before it reaches the LP browser.
  letter.portfolio_table_html = sanitizeLetterHtml(letter.portfolio_table_html)

  await logLpAccessEvent(admin, {
    fundId,
    lpAccountId,
    authUserId: user.id,
    lpInvestorId: sharedInvestorIds[0] ?? null,
    eventType: 'view',
    targetType: 'letter',
    targetId: letterId,
    targetTitle: letter.period_label,
    metadata: { investor_ids: sharedInvestorIds },
  })

  return NextResponse.json({ letter })
}
