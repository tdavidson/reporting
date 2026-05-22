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
 * Partner edits to a draft. Body shape (all optional):
 *   {
 *     paragraph_edits:      [{ id, prose, origin? }],
 *     paragraph_order:      [{ id, section_id, order }],   // reorder / move
 *     paragraph_visibility: [{ id, hidden }],              // hide / show
 *     paragraph_inserts:    [{ section_id, order, prose }],// new partner paragraphs
 *     score_edits:          [{ dimension_id, score, confidence?, rationale? }],
 *   }
 *
 * Edits mutate the draft in-place; they don't branch it. To create a new
 * draft version, partners use the agent's Re-run draft action.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string; draftId: string } }) {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const { data: row } = await admin
    .from('diligence_memo_drafts')
    .select('id, memo_draft_output, ingestion_output, is_draft')
    .eq('id', params.draftId)
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(row as any).is_draft) return NextResponse.json({ error: 'Draft is finalized — edits are locked.' }, { status: 409 })

  const body = await req.json().catch(() => ({}))
  const memoOutput = ((row as any).memo_draft_output as any) ?? { paragraphs: [], scores: [], partner_attention: [] }
  const ingestionOutput = ((row as any).ingestion_output as any) ?? null
  let ingestionChanged = false

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

  // Reorder / move paragraphs between sections.
  if (Array.isArray(body.paragraph_order)) {
    const moveById = new Map<string, { section_id?: string; order?: number }>()
    for (const e of body.paragraph_order) {
      if (typeof e?.id !== 'string') continue
      moveById.set(e.id, {
        section_id: typeof e.section_id === 'string' ? e.section_id : undefined,
        order: typeof e.order === 'number' ? e.order : undefined,
      })
    }
    memoOutput.paragraphs = (memoOutput.paragraphs ?? []).map((p: any) => {
      const m = moveById.get(p.id)
      if (!m) return p
      return {
        ...p,
        section_id: m.section_id ?? p.section_id,
        order: m.order ?? p.order,
      }
    })
  }

  // Hide / show paragraphs.
  if (Array.isArray(body.paragraph_visibility)) {
    const hiddenById = new Map<string, boolean>()
    for (const e of body.paragraph_visibility) {
      if (typeof e?.id === 'string' && typeof e.hidden === 'boolean') hiddenById.set(e.id, e.hidden)
    }
    memoOutput.paragraphs = (memoOutput.paragraphs ?? []).map((p: any) =>
      hiddenById.has(p.id) ? { ...p, hidden: hiddenById.get(p.id) } : p
    )
  }

  // Insert new partner-written paragraphs.
  if (Array.isArray(body.paragraph_inserts)) {
    const inserts = body.paragraph_inserts
      .filter((e: any) => e && typeof e.section_id === 'string' && typeof e.prose === 'string')
      .map((e: any) => ({
        id: `p_partner_${Math.random().toString(36).slice(2, 10)}`,
        section_id: e.section_id,
        order: typeof e.order === 'number' ? e.order : 0,
        prose: e.prose,
        sources: [],
        origin: 'partner_drafted',
        confidence: 'n/a',
        contains_projection: false,
        contains_unverified_claim: false,
        contains_contradiction: false,
        hidden: false,
      }))
    memoOutput.paragraphs = [...(memoOutput.paragraphs ?? []), ...inserts]
  }

  // Replace the ingestion gap_analysis — used by the interactive ingestion
  // summary so a partner can dismiss false "missing"/"inadequate" findings.
  // The client sends the full updated gap_analysis object.
  if (body.ingestion_gap_analysis && typeof body.ingestion_gap_analysis === 'object' && ingestionOutput) {
    ingestionOutput.gap_analysis = body.ingestion_gap_analysis
    ingestionChanged = true
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

  const update: Record<string, unknown> = { memo_draft_output: memoOutput }
  if (ingestionChanged) update.ingestion_output = ingestionOutput

  const { error } = await admin
    .from('diligence_memo_drafts')
    .update(update as any)
    .eq('id', params.draftId)
    .eq('fund_id', fundId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Return the updated output so the editor can re-sync without a second
  // round-trip (needed for inserts — the new paragraph id is server-generated).
  return NextResponse.json({ ok: true, memo_draft_output: memoOutput, ingestion_output: ingestionOutput })
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
