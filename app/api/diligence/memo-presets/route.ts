import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MemoTemplateConfig } from '@/lib/memo-agent/prompts/memo-config'

const VALID_STYLES = new Set(['pre_seed', 'seed', 'series_a', 'series_b', 'growth'])
const VALID_COMPLEXITY = new Set(['brief', 'standard', 'detailed', 'comprehensive'])

interface PresetRow {
  id: string
  name: string
  description: string | null
  partner_memo_guidance: string
  memo_template_config: MemoTemplateConfig
  default_for_stage: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export async function GET() {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const { data, error } = await (admin as any)
    .from('fund_memo_presets')
    .select('*')
    .eq('fund_id', fundId)
    .order('updated_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ presets: (data ?? []) as PresetRow[] })
}

export async function POST(req: NextRequest) {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId, userId } = guard

  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const description = typeof body.description === 'string' ? body.description.trim() : null
  const partner_memo_guidance = typeof body.partner_memo_guidance === 'string' ? body.partner_memo_guidance : ''
  const memo_template_config = sanitizeConfig(body.memo_template_config)
  const default_for_stage = typeof body.default_for_stage === 'string' && VALID_STYLES.has(body.default_for_stage)
    ? body.default_for_stage
    : null

  // If the partner is making this the default for a stage, clear the existing
  // default first (only one preset per stage can hold that role — schema-
  // enforced, but we'd rather hand the partner a clean swap than a constraint
  // error).
  if (default_for_stage) {
    await (admin as any)
      .from('fund_memo_presets')
      .update({ default_for_stage: null, updated_at: new Date().toISOString() })
      .eq('fund_id', fundId)
      .eq('default_for_stage', default_for_stage)
  }

  const { data, error } = await (admin as any)
    .from('fund_memo_presets')
    .insert({
      fund_id: fundId,
      name,
      description,
      partner_memo_guidance,
      memo_template_config,
      default_for_stage,
      created_by: userId,
    })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ preset: data })
}

function sanitizeConfig(raw: unknown): MemoTemplateConfig {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const clean: MemoTemplateConfig = {}
  if (typeof r.style_override === 'string' && VALID_STYLES.has(r.style_override)) {
    clean.style_override = r.style_override as MemoTemplateConfig['style_override']
  } else if (r.style_override === null || r.style_override === '') {
    clean.style_override = null
  }
  if (typeof r.analyst_persona === 'string') clean.analyst_persona = r.analyst_persona
  if (typeof r.complexity === 'string' && VALID_COMPLEXITY.has(r.complexity)) {
    clean.complexity = r.complexity as MemoTemplateConfig['complexity']
  }
  if (Array.isArray(r.emphasis)) {
    clean.emphasis = r.emphasis.filter((e): e is string => typeof e === 'string').map(e => e.trim()).filter(Boolean).slice(0, 20)
  }
  if (r.section_overrides && typeof r.section_overrides === 'object') {
    const ov: Record<string, { included?: boolean; target_paragraphs?: number | null }> = {}
    for (const [k, v] of Object.entries(r.section_overrides as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const entry = v as { included?: unknown; target_paragraphs?: unknown }
      const out: { included?: boolean; target_paragraphs?: number | null } = {}
      if (typeof entry.included === 'boolean') out.included = entry.included
      if (typeof entry.target_paragraphs === 'number' && entry.target_paragraphs > 0) {
        out.target_paragraphs = Math.min(20, Math.round(entry.target_paragraphs))
      } else if (entry.target_paragraphs === null) {
        out.target_paragraphs = null
      }
      ov[k] = out
    }
    clean.section_overrides = ov
  }
  return clean
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
  return { admin, fundId: (membership as any).fund_id as string, userId: user.id }
}
