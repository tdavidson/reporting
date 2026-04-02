import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scrapeVCDeals } from '@/lib/vc-market/scrapers'
import { sendDealDigest } from '@/lib/vc-market/digest-email'

function serializeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}${err.cause ? ` (cause: ${err.cause})` : ''}`
  if (typeof err === 'object' && err !== null) {
    try { return JSON.stringify(err) } catch { return Object.prototype.toString.call(err) }
  }
  return String(err)
}

export async function GET() {
  try {
    // The scraper is global — not per fund/user.
    // CRON_USER_ID is a system user whose id populates vc_deals_pending.user_id.
    const cronUserId = process.env.CRON_USER_ID
    if (!cronUserId) {
      console.error('[vc-market/cron] CRON_USER_ID env var not set')
      return NextResponse.json({ error: 'CRON_USER_ID not configured' }, { status: 500 })
    }

    const db = createAdminClient() as any // eslint-disable-line @typescript-eslint/no-explicit-any

    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const { data: existingDeals } = await db
      .from('vc_deals_pending')
      .select('company_name, deal_date, stage')
      .gte('deal_date', sixtyDaysAgo)

    const { deals, report } = await scrapeVCDeals(
      cronUserId,
      existingDeals ?? [],
    )

    console.log(
      `[vc-market/cron] sources=${report.sources.length} articles=${report.uniqueArticles}` +
      ` extracted=${report.dealsExtracted} filtered=${report.dealsAfterFilter}` +
      (report.aiError ? ` aiError=${report.aiError}` : ''),
    )

    if (deals.length === 0) {
      return NextResponse.json({ inserted: 0, skipped: 0, errors: [] })
    }

    const { data: inserted, error: upsertError } = await db
      .from('vc_deals_pending')
      .upsert(
        deals.map((d: Record<string, unknown>) => ({ ...d, status: 'pending' })),
        { onConflict: 'user_id,company_name,deal_date', ignoreDuplicates: true },
      )
      .select('id')

    if (upsertError) {
      console.error('[vc-market/cron] upsertError:', JSON.stringify(upsertError))
      return NextResponse.json({ error: serializeError(upsertError) }, { status: 500 })
    }

    const insertedCount = inserted?.length ?? deals.length
    const skipped = deals.length - insertedCount

    if (insertedCount > 0) {
      await sendDealDigest(db, cronUserId, null, deals.slice(0, insertedCount))
    }

    console.log(`[vc-market/cron] inserted=${insertedCount} skipped=${skipped}`)
    return NextResponse.json({ inserted: insertedCount, skipped, errors: [] })

  } catch (err) {
    const msg = serializeError(err)
    console.error('[vc-market/cron] fatal:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
