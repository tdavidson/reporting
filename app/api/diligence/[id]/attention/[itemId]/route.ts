import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const VALID_STATUSES = ['open', 'addressed', 'deferred'] as const

export async function PATCH(req: NextRequest, { params }: { params: { id: string; itemId: string } }) {
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

  const body = await req.json().catch(() => ({}))
  const updates: Record<string, unknown> = {}
  if (typeof body.status === 'string') {
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    updates.status = body.status
    if (body.status !== 'open') {
      updates.resolved_at = new Date().toISOString()
      updates.resolved_by = user.id
    } else {
      updates.resolved_at = null
      updates.resolved_by = null
    }
  }
  if (typeof body.resolution_note === 'string' || body.resolution_note === null) {
    updates.resolution_note = body.resolution_note?.trim() || null
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error } = await admin
    .from('diligence_attention_items')
    .update(updates)
    .eq('id', params.itemId)
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
