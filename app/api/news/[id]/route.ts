/**
 * DELETE /api/news/[id]
 *
 * Permanently deletes a news article from the fund's news_articles table.
 * Scoped to the authenticated user's fund — users cannot delete articles
 * that don't belong to their fund.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (supabase: ReturnType<typeof createClient>) => supabase as any

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Resolve the user's active fund
    const { data: member } = await supabase
      .from('fund_members')
      .select('fund_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle()

    if (!member?.fund_id) {
      return NextResponse.json({ error: 'No active fund' }, { status: 403 })
    }

    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    const { error } = await db(supabase)
      .from('news_articles')
      .delete()
      .eq('id', id)
      .eq('fund_id', member.fund_id)  // fund-scoped guard

    if (error) {
      console.error('[news/delete] Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[news/delete] unexpected error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
