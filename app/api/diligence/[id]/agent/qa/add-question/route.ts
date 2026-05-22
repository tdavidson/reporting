import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Append a partner-authored Q&A entry to the deal's latest draft. The partner
 * supplies both the question and their own answer/judgment — it feeds the
 * memo draft alongside the agent-asked Q&A. Independent of the agent Q&A
 * session; finishQA preserves these entries.
 *
 * Body: { question_text: string, answer_text: string }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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
  const questionText = typeof body.question_text === 'string' ? body.question_text.trim() : ''
  const answerText = typeof body.answer_text === 'string' ? body.answer_text.trim() : ''
  if (!questionText) return NextResponse.json({ error: 'question_text is required' }, { status: 400 })
  if (!answerText) return NextResponse.json({ error: 'answer_text is required' }, { status: 400 })

  // Target the latest in-progress draft for the deal.
  const { data: draft } = await admin
    .from('diligence_memo_drafts')
    .select('id, qa_answers, is_draft')
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .eq('is_draft', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!draft) {
    return NextResponse.json({ error: 'No draft yet. Run Stage 1 ingest first.' }, { status: 409 })
  }

  const existing = Array.isArray((draft as any).qa_answers) ? (draft as any).qa_answers as any[] : []
  const entry = {
    question_id: `partner_q_${Math.random().toString(36).slice(2, 10)}`,
    question_text: questionText,
    answer_text: answerText,
    partner_id: user.id,
    answered_at: new Date().toISOString(),
    feeds_dimensions: [],
    category: 'partner_question',
  }

  const { error } = await admin
    .from('diligence_memo_drafts')
    .update({ qa_answers: [...existing, entry] as any })
    .eq('id', (draft as any).id)
    .eq('fund_id', fundId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, question_id: entry.question_id })
}
