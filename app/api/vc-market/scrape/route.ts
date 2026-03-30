import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scrapeVCDeals } from '@/lib/vc-market/scrapers'

export async function POST() {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any

    const { data: settings } = await db
      .from('settings')
      .select('claude_api_key')
      .eq('user_id', user.id)
      .maybeSingle()

    const deals = await scrapeVCDeals(user.id, settings?.claude_api_key ?? undefined)

    if (deals.length === 0) {
      return NextResponse.json({ pending: 0, skipped: 0 })
    }

    // Save to staging table instead of publishing directly
    const { data: inserted, error } = await db
      .from('vc_deals_pending')
      .upsert(
        deals.map(d => ({ ...d, status: 'pending' })),
        { onConflict: 'user_id,company_name,deal_date', ignoreDuplicates: true }
      )
      .select('id')

    if (error) throw error

    return NextResponse.json({
      pending: inserted?.length ?? deals.length,
      skipped: deals.length - (inserted?.length ?? deals.length),
    })
  } catch (err) {
    console.error('[vc-market/scrape]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
