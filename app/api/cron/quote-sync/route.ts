import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncFundQuotes } from '@/lib/portfolio/quote-sync'

/**
 * Daily quote refresh for every fund holding a quoted position.
 *
 * Auth: the same `Authorization: Bearer ${CRON_SECRET}` pattern as the other crons, and
 * fail-closed — a missing secret refuses traffic rather than opening the loop to anonymous
 * callers.
 *
 * Runs after the US close rather than at midnight. The recommended sheet template reads the
 * last TRADING DAY's close, so a run before the close would store the prior day's price and
 * date — correct, but a day behind, and a period ending today would then mark stale.
 *
 * It only ever stores observations. Nothing here marks a position or writes to the ledger.
 */

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  // Only funds that actually have a feed. A fund with a wholly private book costs one row read
  // and no Google traffic at all.
  const { data: feedFunds } = await (admin as any)
    .from('price_feeds')
    .select('fund_id')
  const fundIds = Array.from(new Set(((feedFunds as any[]) ?? []).map(f => f.fund_id as string)))
  if (fundIds.length === 0) return NextResponse.json({ ok: true, funds: 0 })

  const results = []
  for (const fundId of fundIds) {
    // syncFundQuotes never throws — one fund's lapsed Google connection must not stop the rest.
    results.push(await syncFundQuotes(admin, fundId, today))
  }

  return NextResponse.json({
    ok: true,
    funds: results.length,
    stored: results.reduce((s, r) => s + r.stored, 0),
    results,
  })
}
