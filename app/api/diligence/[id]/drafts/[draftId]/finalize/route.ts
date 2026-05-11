import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Finalize a memo draft. Admin-only. Sets is_draft=false, finalized_at, and
 * finalized_by. The DB constraint (`finalize_consistency`) enforces all three
 * change together. Once finalized, PATCH on the draft returns 409.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string; draftId: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  if ((membership as any).role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 })

  const fundId = (membership as any).fund_id as string

  // Verify the draft has a recommendation paragraph filled in. Per hard rule:
  // recommendation is partner_only — if the prose is still the placeholder,
  // block finalize and prompt the partner to fill it in.
  const { data: row } = await admin
    .from('diligence_memo_drafts')
    .select('id, memo_draft_output, is_draft')
    .eq('id', params.draftId)
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(row as any).is_draft) return NextResponse.json({ error: 'Already finalized' }, { status: 409 })

  const memo = (row as any).memo_draft_output as { paragraphs?: Array<{ section_id: string; prose: string; origin: string }> } | null
  const recommendation = memo?.paragraphs?.find(p => p.section_id === 'recommendation')
  if (!recommendation || recommendation.prose.trim() === '[Partner to complete]' || recommendation.origin === 'partner_only_placeholder') {
    return NextResponse.json({
      error: 'Recommendation section is empty. The partner must complete this before finalizing.',
    }, { status: 422 })
  }

  const { error } = await admin
    .from('diligence_memo_drafts')
    .update({
      is_draft: false,
      finalized_at: new Date().toISOString(),
      finalized_by: user.id,
    } as any)
    .eq('id', params.draftId)
    .eq('fund_id', fundId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await admin
    .from('diligence_deals')
    .update({ current_memo_stage: 'finalized' })
    .eq('id', params.id)
    .eq('fund_id', fundId)

  return NextResponse.json({ ok: true })
}
