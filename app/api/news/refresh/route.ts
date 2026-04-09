/**
 * POST /api/news/refresh
 *
 * Triggers the news pipeline for the authenticated user's fund.
 * Returns a RefreshSummary with added / duplicates / byCompany breakdown.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runNewsPipeline } from '@/lib/news-pipeline'

export async function POST() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: membership } = await supabase
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle() as { data: { fund_id: string } | null }
  if (!membership) return NextResponse.json({ error: 'No fund' }, { status: 403 })

  try {
    const summary = await runNewsPipeline(membership.fund_id, supabase)
    return NextResponse.json(summary)
  } catch (e) {
    console.error('[news/refresh] pipeline error:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Pipeline failed' },
      { status: 500 }
    )
  }
}
