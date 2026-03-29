/**
 * POST /api/vc-market/scrape
 *
 * Triggers the VC deal scraper. Intended to be called daily at 10:00 AM BRT
 * (13:00 UTC) via a cron job / Vercel Cron / external scheduler.
 *
 * Cron schedule (UTC): 0 13 * * 1-5   ← weekdays at 13:00 UTC = 10:00 BRT
 *
 * Pass a secret header to prevent unauthorized triggers:
 *   X-Cron-Secret: <CRON_SECRET env var>
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scrapeVCDeals } from '@/lib/vc-market/scraper'
import type { ScrapeResult } from '@/lib/vc-market/types'
 
export async function POST(req: NextRequest) {
  // Allow both: cron secret header (for scheduled jobs) or authenticated session
  const cronSecret = process.env.CRON_SECRET
  const headerSecret = req.headers.get('x-cron-secret')
 
  let fundId: string | null = null
 
  if (cronSecret && headerSecret === cronSecret) {
    // Cron-triggered: scrape for all funds
    const admin = createAdminClient()
    const { data: funds } = await admin.from('funds').select('id')
    const allFundIds = (funds ?? []).map((f: { id: string }) => f.id)
 
    if (allFundIds.length === 0) {
      return NextResponse.json({ message: 'No funds found' })
    }
 
    let totalInserted = 0
    const allErrors: string[] = []
 
    for (const fid of allFundIds) {
      const result = await scrapeAndInsertForFund(fid)
      totalInserted += result.inserted
      allErrors.push(...result.errors)
    }
 
    return NextResponse.json({ inserted: totalInserted, errors: allErrors })
  }
 
  // Authenticated user trigger (manual scrape from the UI)
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: membership } = await (supabase as any)
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle() as { data: { fund_id: string; role: string } | null }
 
  if (!membership?.fund_id) {
    return NextResponse.json({ error: 'No fund membership found' }, { status: 403 })
  }
  if (membership.role !== 'admin') {
    return NextResponse.json({ error: 'Admin required' }, { status: 403 })
  }
 
  fundId = membership.fund_id
 
  // Fetch AI API key from fund settings
  const { data: settings } = await supabase
    .from('fund_settings')
    .select('claude_api_key_encrypted, encryption_key_encrypted')
    .eq('fund_id', fundId)
    .maybeSingle()
 
  // Attempt to decrypt the API key if available
  let apiKey: string | undefined
  if (settings?.claude_api_key_encrypted && settings?.encryption_key_encrypted) {
    try {
      const { decryptFundApiKey } = await import('@/lib/crypto')
      apiKey = await decryptFundApiKey(
        settings.claude_api_key_encrypted,
        settings.encryption_key_encrypted
      )
    } catch {
      // Fall back to env key
    }
  }
 
  const result = await scrapeAndInsertForFund(fundId, apiKey)
  return NextResponse.json(result)
}
 
async function scrapeAndInsertForFund(
  fundId: string,
  apiKey?: string
): Promise<ScrapeResult> {
  const result: ScrapeResult = { inserted: 0, skipped: 0, errors: [] }
 
  try {
    const deals = await scrapeVCDeals(fundId, apiKey)
    if (deals.length === 0) return result
 
    const admin = createAdminClient()
 
    // Deduplicate against existing deals: same fund + company_name + deal_date
    const dedupeKeys = deals.map(d => `${d.company_name}|${d.deal_date ?? ''}`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (admin as any)
      .from('vc_deals')
      .select('company_name, deal_date')
      .eq('fund_id', fundId)
      .in('company_name', deals.map(d => d.company_name))
 
    const existingKeys = new Set(
      (existing ?? []).map((r: { company_name: string; deal_date: string | null }) =>
        `${r.company_name}|${r.deal_date ?? ''}`
      )
    )
 
    const newDeals = deals.filter((_, i) => !existingKeys.has(dedupeKeys[i]))
    result.skipped = deals.length - newDeals.length
 
    if (newDeals.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (admin as any).from('vc_deals').insert(newDeals)
      if (error) {
        result.errors.push(error.message)
      } else {
        result.inserted = newDeals.length
      }
    }
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err))
  }
 
  return result
}
