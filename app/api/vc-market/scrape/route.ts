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

    // Fetch settings and existing deals in parallel
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const [settingsRes, existingRes] = await Promise.all([
      db.from('settings').select('claude_api_key').eq('user_id', user.id).maybeSingle(),
      db.from('vc_deals_pending').select('company_name, deal_date, stage').gte('deal_date', since),
    ])

    const existingDeals = (existingRes.data ?? []) as {
      company_name: string
      deal_date: string
      stage: string | null
    }[]

    // scrapeVCDeals runs Prompt 1 (extract) + Prompt 2 (review vs DB)
    const { deals, report } = await scrapeVCDeals(
      user.id,
      existingDeals,
      settingsRes.data?.claude_api_key ?? undefined,
    )

    if (deals.length === 0) {
      return NextResponse.json({ pending: 0, skipped: report.dealsExtracted - report.dealsAfterReview, report })
    }

    const { data: inserted, error } = await db
      .from('vc_deals_pending')
      .insert(deals.map((d: Record<string, unknown>) => ({ ...d, status: 'pending' })))
      .select('id')

    if (error) throw error

    return NextResponse.json({
      pending: inserted?.length ?? deals.length,
      skipped: report.dealsExtracted - report.dealsAfterReview,
      report,
    })
  } catch (err) {
    console.error('[vc-market/scrape]', err)
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 })
  }
}
