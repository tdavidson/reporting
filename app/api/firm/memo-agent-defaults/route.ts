import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCapState } from '@/lib/memo-agent/cost'

const VALID_PROVIDERS = ['anthropic', 'openai', 'gemini', 'ollama'] as const
const VALID_STAGES = ['ingest', 'ingest_synthesis', 'research', 'qa', 'draft', 'score', 'render'] as const

export async function GET() {
  const guard = await ensureAdmin()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const { data: settings } = await admin
    .from('fund_settings')
    .select('memo_agent_per_deal_token_cap, memo_agent_monthly_token_cap, memo_agent_stage_models, memo_agent_web_search_enabled, default_ai_provider, memo_export_font_family, memo_export_font_size')
    .eq('fund_id', fundId)
    .maybeSingle()

  const caps = await getCapState(admin, fundId)

  return NextResponse.json({
    per_deal_token_cap: (settings as any)?.memo_agent_per_deal_token_cap ?? null,
    monthly_token_cap: (settings as any)?.memo_agent_monthly_token_cap ?? null,
    stage_models: ((settings as any)?.memo_agent_stage_models as Record<string, any> | null) ?? {},
    web_search_enabled: !!(settings as any)?.memo_agent_web_search_enabled,
    default_ai_provider: (settings as any)?.default_ai_provider ?? null,
    export_font_family: (settings as any)?.memo_export_font_family ?? 'DM Sans',
    export_font_size: (settings as any)?.memo_export_font_size ?? 11,
    monthly_used: caps.monthly_used,
    month_window: caps.month_window,
  })
}

export async function PATCH(req: NextRequest) {
  const guard = await ensureAdmin()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const body = await req.json().catch(() => ({}))
  const updates: Record<string, unknown> = {}

  if (body.per_deal_token_cap !== undefined) {
    updates.memo_agent_per_deal_token_cap = parseCap(body.per_deal_token_cap)
  }
  if (body.monthly_token_cap !== undefined) {
    updates.memo_agent_monthly_token_cap = parseCap(body.monthly_token_cap)
  }
  if (body.stage_models !== undefined && body.stage_models !== null) {
    if (typeof body.stage_models !== 'object') {
      return NextResponse.json({ error: 'stage_models must be an object' }, { status: 400 })
    }
    const cleaned: Record<string, { provider?: string; model?: string } | null> = {}
    for (const [stage, value] of Object.entries(body.stage_models)) {
      if (!VALID_STAGES.includes(stage as any)) continue
      if (value === null) {
        cleaned[stage] = null
        continue
      }
      if (typeof value !== 'object') continue
      const v = value as Record<string, unknown>
      const provider = typeof v.provider === 'string' && VALID_PROVIDERS.includes(v.provider as any) ? v.provider : undefined
      const model = typeof v.model === 'string' && v.model.trim() ? v.model.trim() : undefined
      if (!provider) {
        cleaned[stage] = null
      } else {
        cleaned[stage] = { provider, ...(model ? { model } : {}) }
      }
    }
    updates.memo_agent_stage_models = cleaned as any
  }
  if (body.web_search_enabled !== undefined) {
    updates.memo_agent_web_search_enabled = !!body.web_search_enabled
  }
  if (body.export_font_family !== undefined) {
    const f = typeof body.export_font_family === 'string' ? body.export_font_family.trim() : ''
    updates.memo_export_font_family = f || 'DM Sans'
  }
  if (body.export_font_size !== undefined) {
    const n = Number(body.export_font_size)
    // Clamp to a sane document range.
    updates.memo_export_font_size = isFinite(n) && n >= 6 && n <= 32 ? Math.round(n) : 11
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error } = await admin
    .from('fund_settings')
    .update(updates)
    .eq('fund_id', fundId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

function parseCap(v: unknown): number | null {
  if (v === null || v === '') return null
  const n = Number(v)
  if (!isFinite(n) || n < 0) return null
  return Math.round(n)
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
  return { admin, fundId: (membership as any).fund_id as string }
}
