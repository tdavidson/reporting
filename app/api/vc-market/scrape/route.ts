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

    const { data: settings } = await admin
      .from('settings')
      .select('claude_api_key')
      .eq('user_id', user.id)
      .maybeSingle()

    const deals = await scrapeVCDeals(user.id, (settings as any)?.claude_api_key ?? undefined)

    if (deals.length === 0) {
      return NextResponse.json({ inserted: 0, skipped: 0, errors: [] })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error } = await (admin as any)
      .from('vc_deals')
      .upsert(deals, { onConflict: 'user_id,company_name,deal_date', ignoreDuplicates: true })
      .select('id')

    if (error) throw error

    return NextResponse.json({
      inserted: inserted?.length ?? deals.length,
      skipped:  deals.length - (inserted?.length ?? deals.length),
      errors:   [],
    })
  } catch (err) {
    console.error('[vc-market/scrape]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
