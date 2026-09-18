import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runFundReminders, type FundRunResult } from '@/lib/reminders/run'

/**
 * Daily operational reminders (compliance filings, the quarterly data request, data-request
 * follow-ups) for every fund that turned them on. Triggered by Vercel cron — see vercel.json.
 * Idempotent within a day: reminder_deliveries means a re-run sends nothing new.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: NextRequest) {
  // Fail-closed: missing CRON_SECRET refuses traffic rather than opening the loop to anyone.
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: funds } = await (admin as any)
    .from('fund_settings')
    .select('fund_id')
    .eq('reminders_enabled', true) as { data: { fund_id: string }[] | null }

  const results: FundRunResult[] = []
  for (const { fund_id } of funds ?? []) {
    try {
      results.push(await runFundReminders(admin, fund_id))
    } catch (err) {
      // One fund failing must not stop the others.
      results.push({ fundId: fund_id, items: 0, newKeys: 0, sent: false, error: err instanceof Error ? err.message : 'failed' })
    }
  }

  return NextResponse.json({ ok: true, results })
}
