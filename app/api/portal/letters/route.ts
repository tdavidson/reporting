import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveLpAccess } from '@/lib/api-helpers'
import { getSelfReadState } from '@/lib/lp-access-log'
import { dbError } from '@/lib/api-error'

/**
 * LP portal — list the letters shared with the signed-in LP. Scoped to their
 * investor rows (resolveLpAccess) and limited to funds whose LP portal is on.
 */
export async function GET() {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse) return access
  const { investorIds, lpAccountId } = access
  if (investorIds.length === 0) return NextResponse.json({ letters: [] })

  const { data: shares, error } = await (admin as any)
    .from('lp_letter_shares')
    .select('letter_id, shared_at, fund_id, lp_letters(id, period_label, period_year, period_quarter, status)')
    .in('lp_investor_id', investorIds)
  if (error) return dbError(error, 'portal-letters')

  const fundIds = Array.from(new Set((shares ?? []).map((s: any) => s.fund_id as string)))
  let enabledFunds = new Set<string>()
  if (fundIds.length) {
    const { data: ef } = await (admin as any)
      .from('fund_settings')
      .select('fund_id')
      .eq('lp_portal_enabled', true)
      .in('fund_id', fundIds)
    enabledFunds = new Set((ef ?? []).map((f: any) => f.fund_id as string))
  }

  const byId = new Map<string, { id: string; period_label: string; period_year: number; period_quarter: number; shared_at: string }>()
  for (const s of (shares ?? []) as any[]) {
    if (!enabledFunds.has(s.fund_id)) continue
    const l = s.lp_letters
    // A shared letter surfaces once it has content (anything past 'generating').
    if (l && l.status !== 'generating' && !byId.has(l.id)) {
      byId.set(l.id, { id: l.id, period_label: l.period_label, period_year: l.period_year, period_quarter: l.period_quarter, shared_at: s.shared_at })
    }
  }
  const sorted = Array.from(byId.values()).sort(
    (a, b) => b.period_year - a.period_year || b.period_quarter - a.period_quarter,
  )
  const readState = await getSelfReadState(admin, { lpAccountId, targetType: 'letter', targetIds: sorted.map(l => l.id) })
  const letters = sorted.map(l => ({ ...l, last_viewed_at: readState[l.id] ?? null }))
  return NextResponse.json({ letters })
}
