import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scrapeVCDeals } from '@/lib/vc-market/scrapers'

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null) {
    const e = err as Record<string, unknown>
    if (typeof e.message === 'string') return e.message
    if (typeof e.error === 'string') return e.error
  }
  return String(err)
}

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

    const { deals, report } = await scrapeVCDeals(user.id, settings?.claude_api_key ?? undefined)

    if (deals.length === 0) {
      return NextResponse.json({ pending: 0, skipped: 0, report })
    }

    // Fetch recent deals (last 45 days) to deduplicate before inserting
    const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const { data: existing } = await db
      .from('vc_deals_pending')
      .select('company_name, deal_date, stage')
      .gte('deal_date', since)

    const existingSet = new Set<string>(
      (existing ?? []).map((r: { company_name: string; deal_date: string; stage: string }) =>
        `${r.company_name?.toLowerCase().trim()}|${r.deal_date}|${r.stage?.toLowerCase()}`
      )
    )

    const newDeals = deals.filter((d: Record<string, unknown>) => {
      const key = `${String(d.company_name ?? '').toLowerCase().trim()}|${d.deal_date}|${String(d.stage ?? '').toLowerCase()}`
      return !existingSet.has(key)
    })

    const skipped = deals.length - newDeals.length

    if (newDeals.length === 0) {
      return NextResponse.json({ pending: 0, skipped, report })
    }

    const { data: inserted, error } = await db
      .from('vc_deals_pending')
      .insert(newDeals.map((d: Record<string, unknown>) => ({ ...d, status: 'pending' })))
      .select('id')

    if (error) throw error

    return NextResponse.json({
      pending: inserted?.length ?? newDeals.length,
      skipped,
      report,
    })
  } catch (err) {
    console.error('[vc-market/scrape]', err)
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 })
  }
}
