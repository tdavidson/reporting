import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const STAGES = ['ingest', 'research', 'qa', 'draft', 'score', 'render'] as const
type Stage = typeof STAGES[number]

/**
 * Per-stage editable prompt guidance. Open to all fund members — diligence
 * settings are not admin-gated.
 *
 * GET   → { guidance: { [stage]: string } } for every stage (empty if unset)
 * PATCH → { guidance: { [stage]: string } } upserts the provided stages
 */
export async function GET() {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const { data } = await (admin as any)
    .from('memo_agent_prompts')
    .select('stage, guidance')
    .eq('fund_id', fundId)

  const guidance: Record<string, string> = {}
  for (const s of STAGES) guidance[s] = ''
  for (const row of (data ?? []) as Array<{ stage: string; guidance: string }>) {
    if (row.stage in guidance) guidance[row.stage] = row.guidance ?? ''
  }

  // First-page exemplar (Phase 3) + the fund's sample memos to choose from.
  const [{ data: settings }, { data: anchorRows }] = await Promise.all([
    admin.from('fund_settings').select('memo_first_page_anchor_id').eq('fund_id', fundId).maybeSingle(),
    admin.from('style_anchor_memos').select('id, title, file_name').eq('fund_id', fundId).order('uploaded_at', { ascending: false }),
  ])

  return NextResponse.json({
    guidance,
    first_page_anchor_id: (settings as any)?.memo_first_page_anchor_id ?? null,
    anchors: ((anchorRows ?? []) as Array<{ id: string; title: string | null; file_name: string }>)
      .map(a => ({ id: a.id, label: a.title || a.file_name })),
  })
}

export async function PATCH(req: NextRequest) {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const body = await req.json().catch(() => ({}))

  // First-page exemplar (Phase 3).
  if ('first_page_anchor_id' in body) {
    const id = typeof body.first_page_anchor_id === 'string' && body.first_page_anchor_id ? body.first_page_anchor_id : null
    const { error: setErr } = await admin
      .from('fund_settings')
      .update({ memo_first_page_anchor_id: id } as any)
      .eq('fund_id', fundId)
    if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 })
  }

  const incoming = body?.guidance
  if (incoming && typeof incoming === 'object') {
    const rows: Array<{ fund_id: string; stage: Stage; guidance: string; updated_at: string }> = []
    for (const [stage, value] of Object.entries(incoming)) {
      if (!STAGES.includes(stage as Stage)) continue
      if (typeof value !== 'string') continue
      rows.push({ fund_id: fundId, stage: stage as Stage, guidance: value, updated_at: new Date().toISOString() })
    }
    if (rows.length > 0) {
      const { error } = await (admin as any)
        .from('memo_agent_prompts')
        .upsert(rows as any, { onConflict: 'fund_id,stage' })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}

async function ensureMember() {
  const supabase = createClient()
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
