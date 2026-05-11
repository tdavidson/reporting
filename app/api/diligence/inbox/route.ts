import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Cross-deal Memo Inbox feed. Returns open partner-attention items aggregated
 * across every active diligence deal in the fund, joined with the deal name
 * and current memo stage so the partner can triage without clicking into each
 * deal.
 *
 * Mirrors the Review queue pattern.
 */
export async function GET(req: NextRequest) {
  const supabase = createClient()
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

  const status = req.nextUrl.searchParams.get('status') ?? 'open'
  const urgency = req.nextUrl.searchParams.get('urgency')

  let attentionQuery = admin
    .from('diligence_attention_items')
    .select('id, deal_id, draft_id, kind, urgency, body, links, status, resolution_note, resolved_at, created_at')
    .eq('fund_id', fundId)
    .order('created_at', { ascending: false })
    .limit(500)

  if (status !== 'all') attentionQuery = attentionQuery.eq('status', status)
  if (urgency) attentionQuery = attentionQuery.eq('urgency', urgency)

  const { data: items, error } = await attentionQuery
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Hydrate deal names + status. (Postgres JOIN would be ideal but the existing
  // codebase pattern is two queries + a map — match it for consistency.)
  const dealIds = Array.from(new Set(((items as any[]) ?? []).map(r => r.deal_id))) as string[]
  let dealMap: Record<string, { name: string; deal_status: string; current_memo_stage: string }> = {}
  if (dealIds.length > 0) {
    const { data: deals } = await admin
      .from('diligence_deals')
      .select('id, name, deal_status, current_memo_stage')
      .in('id', dealIds)
      .eq('fund_id', fundId)
    for (const d of (deals ?? []) as any[]) {
      dealMap[d.id] = { name: d.name, deal_status: d.deal_status, current_memo_stage: d.current_memo_stage }
    }
  }

  const enriched = ((items as any[]) ?? []).map(r => ({
    ...r,
    deal_name: dealMap[r.deal_id]?.name ?? 'Unknown deal',
    deal_status: dealMap[r.deal_id]?.deal_status ?? null,
    deal_stage: dealMap[r.deal_id]?.current_memo_stage ?? null,
  }))

  // Per-bucket counts for the header badges.
  const counts = {
    open: 0,
    addressed: 0,
    deferred: 0,
    must_address: 0,
    should_address: 0,
    fyi: 0,
  }
  for (const r of (items as any[]) ?? []) {
    if (r.status === 'open') counts.open++
    else if (r.status === 'addressed') counts.addressed++
    else if (r.status === 'deferred') counts.deferred++
    if (r.urgency === 'must_address') counts.must_address++
    else if (r.urgency === 'should_address') counts.should_address++
    else if (r.urgency === 'fyi') counts.fyi++
  }

  return NextResponse.json({ items: enriched, counts })
}
