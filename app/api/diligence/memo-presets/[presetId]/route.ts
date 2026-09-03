import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbError } from '@/lib/api-error'

const VALID_STYLES = new Set(['pre_seed', 'seed', 'series_a', 'series_b', 'growth'])

export async function PATCH(req: NextRequest, props: { params: Promise<{ presetId: string }> }) {
  const params = await props.params;
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const body = await req.json().catch(() => ({}))
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (typeof body.description === 'string') patch.description = body.description.trim() || null
  if (typeof body.partner_memo_guidance === 'string') patch.partner_memo_guidance = body.partner_memo_guidance
  if (body.memo_template_config && typeof body.memo_template_config === 'object') {
    patch.memo_template_config = body.memo_template_config
  }
  if ('default_for_stage' in body) {
    const v = body.default_for_stage
    const next = typeof v === 'string' && VALID_STYLES.has(v) ? v : null
    if (next) {
      // Same swap-cleanup as in POST — clear any existing default for that stage.
      await (admin as any)
        .from('fund_memo_presets')
        .update({ default_for_stage: null, updated_at: new Date().toISOString() })
        .eq('fund_id', fundId)
        .eq('default_for_stage', next)
        .neq('id', params.presetId)
    }
    patch.default_for_stage = next
  }

  const { data, error } = await (admin as any)
    .from('fund_memo_presets')
    .update(patch)
    .eq('id', params.presetId)
    .eq('fund_id', fundId)
    .select('*')
    .single()
  if (error) return dbError(error, 'diligence-memo-preset-update')
  return NextResponse.json({ preset: data })
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ presetId: string }> }) {
  const params = await props.params;
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const { error } = await (admin as any)
    .from('fund_memo_presets')
    .delete()
    .eq('id', params.presetId)
    .eq('fund_id', fundId)
  if (error) return dbError(error, 'diligence-memo-preset-delete')
  return NextResponse.json({ ok: true })
}

async function ensureMember() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return { error: NextResponse.json({ error: 'No fund found' }, { status: 403 }) }
  return { admin, fundId: (membership as any).fund_id as string }
}
