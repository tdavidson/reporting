import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveLpAccess } from '@/lib/api-helpers'

/**
 * LP portal — the signed-in LP's conversation with their fund: what they sent from the Contact
 * form, the fund's replies, and announcements addressed to their investors. Scoped strictly to
 * the investors resolveLpAccess grants, for funds whose portal is on.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse) return access
  const { investorIds } = access
  if (investorIds.length === 0) return NextResponse.json({ messages: [] })

  const { data: invRows } = await admin.from('lp_investors').select('id, fund_id, name').in('id', investorIds)
  const fundIds = Array.from(new Set(((invRows ?? []) as any[]).map(r => r.fund_id as string)))
  if (fundIds.length === 0) return NextResponse.json({ messages: [] })
  const { data: ef } = await admin.from('fund_settings').select('fund_id').eq('lp_portal_enabled', true).in('fund_id', fundIds)
  const enabled = new Set(((ef ?? []) as any[]).map(f => f.fund_id as string))
  if (enabled.size === 0) return NextResponse.json({ messages: [] })
  const fundName = new Map<string, string>()
  const { data: funds } = await admin.from('funds').select('id, name').in('id', Array.from(enabled))
  for (const f of ((funds ?? []) as any[])) fundName.set(f.id, f.name)

  const { data } = await admin
    .from('lp_messages')
    .select('id, fund_id, subject, body, created_at, direction, parent_id, announcement_id, lp_investor_id')
    .in('lp_investor_id', investorIds)
    .in('fund_id', Array.from(enabled))
    .order('created_at', { ascending: true })
    .limit(500)

  const messages = ((data ?? []) as any[]).map(r => ({
    id: r.id,
    fund: fundName.get(r.fund_id) ?? 'Your fund',
    subject: r.subject,
    body: r.body,
    created_at: r.created_at,
    // 'you' wrote it, or 'fund' did; an announcement is a fund message with no parent.
    from: r.direction === 'outbound' ? 'fund' : 'you',
    kind: r.direction === 'outbound' ? (r.announcement_id ? 'announcement' : 'reply') : 'message',
    parent_id: r.parent_id ?? null,
  }))
  return NextResponse.json({ messages })
}
