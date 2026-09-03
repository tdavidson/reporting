import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

/**
 * Admin-only: which LPs can see the fund's LIVE report in their portal — the live-publish
 * replacement for freezing-and-sharing a snapshot. Same GET/POST contract as the snapshot share
 * route, so the shared LpSharePanel picker drives it unchanged.
 *
 *   GET  → { lp_investor_ids } currently published to.
 *   POST { lp_investor_ids: string[] } → set the list (upsert + prune), fund-scoped.
 */

async function ctx() {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return { error: writeCheck }
  if (writeCheck.role !== 'admin') return { error: NextResponse.json({ error: 'Admin access required' }, { status: 403 }) }
  return { admin, fundId: writeCheck.fundId as string }
}

export async function GET() {
  const c = await ctx()
  if ('error' in c) return c.error
  const { admin, fundId } = c
  const { data, error } = await (admin as any)
    .from('lp_live_report_shares').select('lp_investor_id').eq('fund_id', fundId)
  if (error) return dbError(error, 'live-report-share')
  return NextResponse.json({ lp_investor_ids: (data ?? []).map((r: any) => r.lp_investor_id) })
}

export async function POST(req: NextRequest) {
  const c = await ctx()
  if ('error' in c) return c.error
  const { admin, fundId } = c

  const body = await req.json().catch(() => ({}))
  const requested: string[] = Array.isArray(body.lp_investor_ids)
    ? body.lp_investor_ids.filter((x: unknown): x is string => typeof x === 'string')
    : []

  // Only investors that actually belong to this fund are shareable.
  const { data: validRows } = await (admin as any)
    .from('lp_investors').select('id').eq('fund_id', fundId)
    .in('id', requested.length ? requested : ['00000000-0000-0000-0000-000000000000'])
  const valid = new Set((validRows ?? []).map((r: any) => r.id))
  const target = requested.filter(id => valid.has(id))

  const { data: current } = await (admin as any)
    .from('lp_live_report_shares').select('lp_investor_id').eq('fund_id', fundId)
  const currentIds = new Set((current ?? []).map((r: any) => r.lp_investor_id))
  const toRemove = Array.from(currentIds).filter(id => !target.includes(id as string))
  const toAdd = target.filter(id => !currentIds.has(id))

  if (toRemove.length) {
    await (admin as any).from('lp_live_report_shares').delete().eq('fund_id', fundId).in('lp_investor_id', toRemove)
  }
  if (toAdd.length) {
    const { error: insErr } = await (admin as any)
      .from('lp_live_report_shares').insert(toAdd.map(lp_investor_id => ({ fund_id: fundId, lp_investor_id })))
    if (insErr) return dbError(insErr, 'live-report-share')
  }

  return NextResponse.json({ ok: true, lp_investor_ids: target })
}
