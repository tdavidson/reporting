import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(_req: NextRequest, { params }: { params: { id: string; draftId: string } }) {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const { data, error } = await admin
    .from('diligence_memo_drafts')
    .select('*')
    .eq('id', params.draftId)
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

/**
 * Partner edits to specific paragraphs or scores within a draft. The body shape:
 *   { paragraph_edits: [{ id, prose, origin? }], score_edits: [{ dimension_id, score, confidence?, rationale? }] }
 *
 * Edits create a new paragraph_record/score_record entry in-place; they don't
 * branch the draft. To create a new draft version, partners use the agent's
 * Re-run draft action (which enqueues a new draft job).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string; draftId: string } }) {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const { data: row } = await admin
    .from('diligence_memo_drafts')
    .select('id, memo_draft_output, is_draft')
    .eq('id', params.draftId)
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(row as any).is_draft) return NextResponse.json({ error: 'Draft is finalized — edits are locked.' }, { status: 409 })

  const body = await req.json().catch(() => ({}))
  const memoOutput = ((row as any).memo_draft_output as any) ?? { paragraphs: [], scores: [], partner_attention: [] }

  if (Array.isArray(body.paragraph_edits)) {
    const editsById = new Map<string, { prose?: string; origin?: string }>()
    for (const e of body.paragraph_edits) {
      if (typeof e?.id !== 'string') continue
      editsById.set(e.id, { prose: typeof e.prose === 'string' ? e.prose : undefined, origin: e.origin })
    }
    memoOutput.paragraphs = (memoOutput.paragraphs ?? []).map((p: any) => {
      const edit = editsById.get(p.id)
      if (!edit) return p
      return {
        ...p,
        prose: edit.prose ?? p.prose,
        origin: 'partner_edited',
      }
    })
  }

  if (Array.isArray(body.score_edits)) {
    const editsById = new Map<string, { score?: number | null; confidence?: string | null; rationale?: string }>()
    for (const e of body.score_edits) {
      if (typeof e?.dimension_id !== 'string') continue
      editsById.set(e.dimension_id, {
        score: typeof e.score === 'number' || e.score === null ? e.score : undefined,
        confidence: typeof e.confidence === 'string' || e.confidence === null ? e.confidence : undefined,
        rationale: typeof e.rationale === 'string' ? e.rationale : undefined,
      })
    }
    memoOutput.scores = (memoOutput.scores ?? []).map((s: any) => {
      const edit = editsById.get(s.dimension_id)
      if (!edit) return s
      return {
        ...s,
        score: edit.score !== undefined ? edit.score : s.score,
        confidence: edit.confidence !== undefined ? edit.confidence : s.confidence,
        rationale: edit.rationale !== undefined ? edit.rationale : s.rationale,
        partner_edited: true,
      }
    })
  }

  const { error } = await admin
    .from('diligence_memo_drafts')
    .update({ memo_draft_output: memoOutput as any })
    .eq('id', params.draftId)
    .eq('fund_id', fundId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

async function ensureMember() {
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
  return { admin, fundId: (membership as any).fund_id as string, userId: user.id, role: (membership as any).role as string }
}
