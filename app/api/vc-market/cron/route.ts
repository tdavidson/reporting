import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scrapeVCDeals } from '@/lib/vc-market/scrapers'
import { sendDealDigest } from '@/lib/vc-market/digest-email'

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createAdminClient() as any

    // Fetch all users with settings (includes fund_id for email config lookup)
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
        const deals = await scrapeVCDeals(setting.user_id, setting.claude_api_key ?? undefined)
        if (deals.length === 0) continue

        const { data: inserted, error } = await db
          .from('vc_deals')
          .upsert(deals, { onConflict: 'user_id,company_name,deal_date', ignoreDuplicates: true })
          .select('id')

        if (error) throw error

        const insertedCount = inserted?.length ?? deals.length
        const newDeals = deals.slice(0, insertedCount)

        totalInserted += insertedCount
        totalSkipped  += deals.length - insertedCount

        // Send digest only if new deals were actually inserted
        if (insertedCount > 0 && setting.fund_id) {
          await sendDealDigest(db, setting.user_id, setting.fund_id, newDeals)
        }
      } catch (err) {
        errors.push(`user ${setting.user_id}: ${String(err)}`)
      }
    }

    console.log(`[vc-market/cron] inserted=${totalInserted} skipped=${totalSkipped} errors=${errors.length}`)

    return NextResponse.json({
      inserted: totalInserted,
      skipped:  totalSkipped,
      errors,
    })
  } catch (err) {
    console.error('[vc-market/cron]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
