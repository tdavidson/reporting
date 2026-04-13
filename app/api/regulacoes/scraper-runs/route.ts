import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '10', 10), 50)

    const db = createAdminClient() as any // eslint-disable-line
    const { data, error } = await db
      .from('scraper_runs')
      .select('id, ran_at, trigger, user_email, year, inserted, skipped, error')
      .order('ran_at', { ascending: false })
      .limit(limit)

    if (error) throw error
    return NextResponse.json(data ?? [])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
