import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scrapeVCDeals } from '@/lib/vc-market/scrapers'
import { decryptApiKey } from '@/lib/crypto'

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

    // Resolve fund_id for this user
    const { data: membership } = await db
      .from('fund_members')
      .select('fund_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!membership?.fund_id) {
      return NextResponse.json({ error: 'No fund found for user' }, { status: 404 })
    }

    // Fetch fund_settings (encrypted key) and existing deals in parallel
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const [settingsRes, existingRes] = await Promise.all([
      db
        .from('fund_settings')
        .select('claude_api_key_encrypted, encryption_key_encrypted')
        .eq('fund_id', membership.fund_id)
        .maybeSingle(),
      db
        .from('vc_deals_pending')
        .select('company_name, deal_date, stage')
        .gte('deal_date', since),
    ])

    // Decrypt the API key using envelope encryption (KEK → DEK → key)
    let claudeApiKey: string | undefined
    const s = settingsRes.data
    if (s?.claude_api_key_encrypted && s?.encryption_key_encrypted) {
      try {
        claudeApiKey = decryptApiKey(s.claude_api_key_encrypted, s.encryption_key_encrypted)
      } catch (decryptErr) {
        console.error('[vc-market/scrape] Failed to decrypt claude_api_key:', decryptErr)
        return NextResponse.json(
          { error: 'Failed to decrypt Claude API key. Check ENCRYPTION_KEY env var.' },
          { status: 500 },
        )
      }
    }

    // Fall back to server-level env var if no per-fund key is configured
    claudeApiKey ??= process.env.ANTHROPIC_API_KEY

    if (!claudeApiKey) {
      return NextResponse.json(
        { error: 'No Claude API key configured. Add one in Settings → AI.' },
        { status: 400 },
      )
    }

    const existingDeals = (existingRes.data ?? []) as {
      company_name: string
      deal_date: string
      stage: string | null
    }[]

    // scrapeVCDeals runs Prompt 1 (extract) + Prompt 2 (review vs DB)
    const { deals, report } = await scrapeVCDeals(
      user.id,
      existingDeals,
      claudeApiKey,
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
