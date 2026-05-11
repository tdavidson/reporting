import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const VOICE_LEVELS = ['exemplary', 'representative', 'atypical', 'do_not_match_voice'] as const
const OUTCOMES = ['invested', 'passed', 'lost_competitive', 'withdrew', 'unknown'] as const
const CONVICTIONS = ['high', 'medium', 'low', 'mixed'] as const
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'] as const

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await ensureAdmin()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const { data, error } = await admin
    .from('style_anchor_memos')
    .select('*')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await ensureAdmin()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const body = await req.json().catch(() => ({}))
  const updates: Record<string, unknown> = {}

  if (typeof body.title === 'string' || body.title === null) updates.title = body.title?.trim() || null
  if (typeof body.anonymized === 'boolean') updates.anonymized = body.anonymized
  if (typeof body.vintage_year === 'number' || body.vintage_year === null) updates.vintage_year = body.vintage_year
  if (typeof body.vintage_quarter === 'string' || body.vintage_quarter === null) {
    if (body.vintage_quarter && !QUARTERS.includes(body.vintage_quarter)) {
      return NextResponse.json({ error: 'Invalid vintage_quarter' }, { status: 400 })
    }
    updates.vintage_quarter = body.vintage_quarter || null
  }
  if (typeof body.sector === 'string' || body.sector === null) updates.sector = body.sector?.trim() || null
  if (typeof body.deal_stage_at_writing === 'string' || body.deal_stage_at_writing === null) {
    updates.deal_stage_at_writing = body.deal_stage_at_writing?.trim() || null
  }
  if (typeof body.outcome === 'string' || body.outcome === null) {
    if (body.outcome && !OUTCOMES.includes(body.outcome)) {
      return NextResponse.json({ error: 'Invalid outcome' }, { status: 400 })
    }
    updates.outcome = body.outcome || null
  }
  if (typeof body.conviction_at_writing === 'string' || body.conviction_at_writing === null) {
    if (body.conviction_at_writing && !CONVICTIONS.includes(body.conviction_at_writing)) {
      return NextResponse.json({ error: 'Invalid conviction_at_writing' }, { status: 400 })
    }
    updates.conviction_at_writing = body.conviction_at_writing || null
  }
  if (typeof body.voice_representativeness === 'string') {
    if (!VOICE_LEVELS.includes(body.voice_representativeness)) {
      return NextResponse.json({ error: 'Invalid voice_representativeness' }, { status: 400 })
    }
    updates.voice_representativeness = body.voice_representativeness
  }
  if (typeof body.authorship === 'string' || body.authorship === null) updates.authorship = body.authorship?.trim() || null
  if (typeof body.author_initials === 'string' || body.author_initials === null) updates.author_initials = body.author_initials?.trim() || null
  if (Array.isArray(body.focus_attention_on)) updates.focus_attention_on = body.focus_attention_on as any
  if (Array.isArray(body.deprioritize_in_this_memo)) updates.deprioritize_in_this_memo = body.deprioritize_in_this_memo as any
  if (typeof body.partner_notes === 'string' || body.partner_notes === null) updates.partner_notes = body.partner_notes?.trim() || null

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error } = await admin
    .from('style_anchor_memos')
    .update(updates)
    .eq('id', params.id)
    .eq('fund_id', fundId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await ensureAdmin()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const { data: anchor } = await admin
    .from('style_anchor_memos')
    .select('storage_path')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!anchor) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await admin
    .from('style_anchor_memos')
    .delete()
    .eq('id', params.id)
    .eq('fund_id', fundId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if ((anchor as any).storage_path) {
    admin.storage.from('style-anchor-memos').remove([(anchor as any).storage_path]).catch(err => {
      console.warn('[style-anchor-memos] storage cleanup failed:', err)
    })
  }

  return NextResponse.json({ ok: true })
}

async function ensureAdmin() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return { error: NextResponse.json({ error: 'No fund found' }, { status: 403 }) }
  if ((membership as any).role !== 'admin') return { error: NextResponse.json({ error: 'Admin required' }, { status: 403 }) }
  return { admin, fundId: (membership as any).fund_id as string, userId: user.id }
}
