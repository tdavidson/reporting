import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MemoTemplateConfig } from '@/lib/memo-agent/prompts/memo-config'

const VALID_STYLES = new Set(['pre_seed', 'seed', 'series_a', 'series_b', 'growth'])
const VALID_COMPLEXITY = new Set(['brief', 'standard', 'detailed', 'comprehensive'])

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const { data, error } = await admin
    .from('diligence_deals')
    .select('partner_memo_guidance, memo_template_config')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    partner_memo_guidance: (data as any).partner_memo_guidance ?? '',
    memo_template_config: ((data as any).memo_template_config ?? {}) as MemoTemplateConfig,
  })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const body = await req.json().catch(() => ({}))
  const patch: Record<string, unknown> = {}

  if (typeof body.partner_memo_guidance === 'string') {
    patch.partner_memo_guidance = body.partner_memo_guidance
  }

  if (body.memo_template_config && typeof body.memo_template_config === 'object') {
    const raw = body.memo_template_config as Record<string, unknown>
    const clean: MemoTemplateConfig = {}

    if (typeof raw.style_override === 'string' && VALID_STYLES.has(raw.style_override)) {
      clean.style_override = raw.style_override as MemoTemplateConfig['style_override']
    } else if (raw.style_override === null || raw.style_override === '') {
      clean.style_override = null
    }

    if (typeof raw.analyst_persona === 'string') {
      clean.analyst_persona = raw.analyst_persona
    }

    if (typeof raw.complexity === 'string' && VALID_COMPLEXITY.has(raw.complexity)) {
      clean.complexity = raw.complexity as MemoTemplateConfig['complexity']
    }

    if (Array.isArray(raw.emphasis)) {
      clean.emphasis = raw.emphasis
        .filter((e): e is string => typeof e === 'string')
        .map(e => e.trim())
        .filter(Boolean)
        .slice(0, 20)
    }

    if (raw.section_overrides && typeof raw.section_overrides === 'object') {
      const ov: Record<string, { included?: boolean; target_paragraphs?: number | null }> = {}
      for (const [k, v] of Object.entries(raw.section_overrides as Record<string, unknown>)) {
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

    patch.memo_template_config = clean as any
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('diligence_deals')
    .update(patch as any)
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .select('partner_memo_guidance, memo_template_config')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    partner_memo_guidance: (data as any).partner_memo_guidance ?? '',
    memo_template_config: ((data as any).memo_template_config ?? {}) as MemoTemplateConfig,
  })
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
