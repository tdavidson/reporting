import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scrapeVCDeals } from '@/lib/vc-market/scrapers'
import { sendDealDigest } from '@/lib/vc-market/digest-email'

export async function GET() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createAdminClient() as any

    const { data: adminSettings, error: settingsError } = await db
      .from('settings')
      .select('user_id, fund_id, claude_api_key')

    if (settingsError) throw settingsError
    if (!adminSettings || adminSettings.length === 0) {
      return NextResponse.json({ message: 'No users found', inserted: 0, skipped: 0 })
    }

    let totalInserted = 0
    let totalSkipped  = 0
    const errors: string[] = []

    for (const setting of adminSettings) {
      try {
        // Fetch existing deals from last 60 days for dedup
        const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        const { data: existingDeals } = await db
          .from('vc_deals_pending')
          .select('company_name, deal_date, stage')
          .eq('user_id', setting.user_id)
          .gte('deal_date', sixtyDaysAgo)

        const { deals, report } = await scrapeVCDeals(
          setting.user_id,
          existingDeals ?? [],
          setting.claude_api_key ?? undefined,
        )

        console.log(`[vc-market/cron] user=${setting.user_id} sources=${report.sources.length} articles=${report.uniqueArticles} extracted=${report.dealsExtracted} filtered=${report.dealsAfterFilter}${
          report.aiError ? ` aiError=${report.aiError}` : ''
        }`)

        if (deals.length === 0) continue

        const { data: inserted, error } = await db
          .from('vc_deals_pending')
          .upsert(
            deals.map((d: Record<string, unknown>) => ({ ...d, status: 'pending' })),
            { onConflict: 'user_id,company_name,deal_date', ignoreDuplicates: true },
          )
          .select('id')

        if (error) throw error

        const insertedCount = inserted?.length ?? deals.length
        const newDeals = deals.slice(0, insertedCount)

        totalInserted += insertedCount
        totalSkipped  += deals.length - insertedCount

        if (insertedCount > 0) {
          await sendDealDigest(db, setting.user_id, setting.fund_id ?? null, newDeals)
        }
      } catch (err) {
        errors.push(`user ${setting.user_id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    console.log(`[vc-market/cron] inserted=${totalInserted} skipped=${totalSkipped} errors=${errors.length}`)

    return NextResponse.json({ inserted: totalInserted, skipped: totalSkipped, errors })
  } catch (err) {
    console.error('[vc-market/cron]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
