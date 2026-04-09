/**
 * GET /api/news/cron
 *
 * Scheduled endpoint — runs the news pipeline for ALL funds.
 * Protected by CRON_SECRET header.
 *
 * Set up in vercel.json:
 *   { "crons": [{ "path": "/api/news/cron", "schedule": "0 6 * * *" }] }
 *
 * Set CRON_SECRET env var and pass it as Authorization: Bearer <CRON_SECRET>
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runNewsPipeline } from '@/lib/news-pipeline'

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const supabase = createClient()

  // Fetch all distinct fund IDs from active companies
  const { data: funds } = await supabase
    .from('fund_members')
    .select('fund_id')
    .order('fund_id')

  const fundIds = [...new Set((funds ?? []).map((r: any) => r.fund_id as string))]

  const results = await Promise.allSettled(
    fundIds.map(fid => runNewsPipeline(fid, supabase))
  )

  const summaries = results.map((r, i) => ({
    fundId: fundIds[i],
    status: r.status,
    ...(r.status === 'fulfilled' ? r.value : { error: String(r.reason) }),
  }))

  return NextResponse.json({ ran: summaries.length, summaries })
}
