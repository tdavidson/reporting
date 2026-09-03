import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbError } from '@/lib/api-error'

/**
 * Settings for external web research on inbound deals.
 *
 * Kept as its own endpoint rather than folded into the (very large) shared
 * settings route: this is two fields with a cost implication, and threading them
 * through that route's 40-field body would be more risk than it's worth.
 */

export async function GET() {
  const guard = await ensureAdmin()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const { data } = await (admin as any)
    .from('fund_settings')
    .select('deal_research_enabled, deal_research_min_fit')
    .eq('fund_id', fundId)
    .maybeSingle()

  return NextResponse.json({
    enabled: !!(data as any)?.deal_research_enabled,
    min_fit: (data as any)?.deal_research_min_fit ?? 'moderate',
  })
}

export async function PUT(req: NextRequest) {
  const guard = await ensureAdmin()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const body = await req.json().catch(() => ({}))
  const update: Record<string, unknown> = {}

  if (typeof body.enabled === 'boolean') update.deal_research_enabled = body.enabled
  if (typeof body.min_fit === 'string') {
    if (!['strong', 'moderate', 'weak'].includes(body.min_fit)) {
      return NextResponse.json({ error: 'min_fit must be strong, moderate, or weak' }, { status: 400 })
    }
    update.deal_research_min_fit = body.min_fit
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error } = await (admin as any)
    .from('fund_settings')
    .update(update)
    .eq('fund_id', fundId)

  if (error) return dbError(error, 'settings-deal-research')
  return NextResponse.json({ ok: true, ...update })
}

async function ensureAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return { error: NextResponse.json({ error: 'No fund found' }, { status: 403 }) }

  // Turning this on spends money on every qualifying inbound deal, so it's an
  // admin decision, not a member one.
  if ((membership as any).role !== 'admin') {
    return { error: NextResponse.json({ error: 'Admins only' }, { status: 403 }) }
  }

  return { admin, fundId: (membership as any).fund_id as string }
}
