import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordResponses } from '@/lib/memo-agent/stages/qa'

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
  const sessionId = typeof body.session_id === 'string' ? body.session_id : ''
  if (!sessionId) return NextResponse.json({ error: 'session_id required' }, { status: 400 })

  const answers = Array.isArray(body.answers) ? body.answers : []
  const valid = answers
    .filter((a: any) => typeof a?.question_id === 'string' && typeof a?.answer_text === 'string')
    .map((a: any) => ({ question_id: a.question_id, answer_text: a.answer_text.trim() }))
    .filter((a: any) => a.answer_text.length > 0)
  if (valid.length === 0) return NextResponse.json({ error: 'No valid answers provided' }, { status: 400 })

  try {
    const result = await recordResponses({ admin, fundId, sessionId, partnerId: user.id, answers: valid })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
