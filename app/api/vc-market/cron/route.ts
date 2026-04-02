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
    const db = createAdminClient()

    const { data: adminSettings, error: settingsError } = await db
      .from('settings')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select('user_id, fund_id, claude_api_key') as any

    if (settingsError) {
      console.error('[vc-market/cron] settingsError:', JSON.stringify(settingsError))
      return NextResponse.json({ error: serializeError(settingsError) }, { status: 500 })
    }
    if (!adminSettings || adminSettings.length === 0) {
      return NextResponse.json({ message: 'No users found', inserted: 0, skipped: 0 })
    }

    let totalInserted = 0
    let totalSkipped  = 0
    const errors: string[] = []

    for (const setting of adminSettings) {
      try {
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

        const { data: inserted, error: upsertError } = await db
          .from('vc_deals_pending')
          .upsert(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            deals.map((d: any) => ({ ...d, status: 'pending' })),
            { onConflict: 'user_id,company_name,deal_date', ignoreDuplicates: true },
          )
          .select('id')

        if (upsertError) throw upsertError

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const insertedCount = (inserted as any)?.length ?? deals.length
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const newDeals = deals.slice(0, insertedCount) as any

        totalInserted += insertedCount
        totalSkipped  += deals.length - insertedCount

        if (insertedCount > 0) {
          await sendDealDigest(db, setting.user_id, setting.fund_id ?? null, newDeals)
        }
      } catch (err) {
        const msg = serializeError(err)
        console.error(`[vc-market/cron] user=${setting.user_id} error:`, msg)
        errors.push(`user ${setting.user_id}: ${msg}`)
      }
    }

    console.log(`[vc-market/cron] inserted=${totalInserted} skipped=${totalSkipped} errors=${errors.length}`)
    return NextResponse.json({ inserted: totalInserted, skipped: totalSkipped, errors })

  } catch (err) {
    const msg = serializeError(err)
    console.error('[vc-market/cron] fatal:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
