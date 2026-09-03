import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbError } from '@/lib/api-error'

/**
 * Manage a single Q&A entry on the deal's latest draft.
 *
 *   PATCH  { question_id, excluded }  → toggle whether the entry feeds the deal
 *                                       evaluation (memo draft + scoring).
 *   DELETE ?question_id=...           → remove the entry entirely.
 *
 * Both target the latest in-progress draft and are fund-scoped.
 */

async function resolve(req: NextRequest, dealId: string) {
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
  const fundId = (membership as any).fund_id as string

  const { data: draft } = await admin
    .from('diligence_memo_drafts')
    .select('id, qa_answers')
    .eq('deal_id', dealId)
    .eq('fund_id', fundId)
    .eq('is_draft', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!draft) return { error: NextResponse.json({ error: 'No draft found.' }, { status: 404 }) }

  const entries = Array.isArray((draft as any).qa_answers) ? (draft as any).qa_answers as any[] : []
  return { admin, fundId, draftId: (draft as any).id as string, entries }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const r = await resolve(req, params.id)
  if ('error' in r) return r.error
  const { admin, fundId, draftId, entries } = r

  const body = await req.json().catch(() => ({}))
  const questionId = typeof body.question_id === 'string' ? body.question_id : ''
  if (!questionId) return NextResponse.json({ error: 'question_id is required' }, { status: 400 })
  const excluded = !!body.excluded

  const next = entries.map(e => (e?.question_id === questionId ? { ...e, excluded } : e))
  const { error } = await admin
    .from('diligence_memo_drafts')
    .update({ qa_answers: next as any })
    .eq('id', draftId)
    .eq('fund_id', fundId)
  if (error) return dbError(error, 'diligence-qa-entry-update')
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const r = await resolve(req, params.id)
  if ('error' in r) return r.error
  const { admin, fundId, draftId, entries } = r

  const questionId = new URL(req.url).searchParams.get('question_id') ?? ''
  if (!questionId) return NextResponse.json({ error: 'question_id is required' }, { status: 400 })

  const next = entries.filter(e => e?.question_id !== questionId)
  const { error } = await admin
    .from('diligence_memo_drafts')
    .update({ qa_answers: next as any })
    .eq('id', draftId)
    .eq('fund_id', fundId)
  if (error) return dbError(error, 'diligence-qa-entry-delete')
  return NextResponse.json({ ok: true })
}
