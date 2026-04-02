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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createAdminClient() as any

    // fund_settings is per-fund and holds AI keys; fund_members gives us a representative user_id per fund
    const { data: fundSettings, error: settingsError } = await db
      .from('fund_settings')
      .select('fund_id, claude_api_key_encrypted, openai_api_key_encrypted, default_ai_provider')

    if (settingsError) {
      console.error('[vc-market/cron] settingsError:', JSON.stringify(settingsError))
      return NextResponse.json({ error: serializeError(settingsError) }, { status: 500 })
    }
    if (!fundSettings || fundSettings.length === 0) {
      return NextResponse.json({ message: 'No funds found', inserted: 0, skipped: 0 })
    }

    // Get one admin/owner user per fund to associate deals with
    const fundIds = fundSettings.map((s: { fund_id: string }) => s.fund_id)
    const { data: members, error: membersError } = await db
      .from('fund_members')
      .select('fund_id, user_id, role')
      .in('fund_id', fundIds)
      .in('role', ['owner', 'admin', 'member'])
      .order('role')

    if (membersError) {
      console.error('[vc-market/cron] membersError:', JSON.stringify(membersError))
      return NextResponse.json({ error: serializeError(membersError) }, { status: 500 })
    }

    // Pick first user per fund (owner preferred due to order)
    const userByFund: Record<string, string> = {}
    for (const m of (members ?? [])) {
      if (!userByFund[m.fund_id]) userByFund[m.fund_id] = m.user_id
    }

    let totalInserted = 0
    let totalSkipped  = 0
    const errors: string[] = []

    for (const setting of fundSettings) {
      const userId = userByFund[setting.fund_id]
      if (!userId) continue

      try {
        const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        const { data: existingDeals } = await db
          .from('vc_deals_pending')
          .select('company_name, deal_date, stage')
          .eq('fund_id', setting.fund_id)
          .gte('deal_date', sixtyDaysAgo)

        const { deals, report } = await scrapeVCDeals(
          userId,
          existingDeals ?? [],
          setting.claude_api_key_encrypted ?? setting.openai_api_key_encrypted ?? undefined,
        )

        console.log(`[vc-market/cron] fund=${setting.fund_id} sources=${report.sources.length} articles=${report.uniqueArticles} extracted=${report.dealsExtracted} filtered=${report.dealsAfterFilter}${
          report.aiError ? ` aiError=${report.aiError}` : ''
        }`)

        if (deals.length === 0) continue

        const { data: inserted, error: upsertError } = await db
          .from('vc_deals_pending')
          .upsert(
            deals.map((d: Record<string, unknown>) => ({ ...d, fund_id: setting.fund_id, status: 'pending' })),
            { onConflict: 'fund_id,company_name,deal_date', ignoreDuplicates: true },
          )
          .select('id')

        if (upsertError) throw upsertError

        const insertedCount = inserted?.length ?? deals.length
        const newDeals = deals.slice(0, insertedCount)

        totalInserted += insertedCount
        totalSkipped  += deals.length - insertedCount

        if (insertedCount > 0) {
          await sendDealDigest(db, userId, setting.fund_id, newDeals)
        }
      } catch (err) {
        const msg = serializeError(err)
        console.error(`[vc-market/cron] fund=${setting.fund_id} error:`, msg)
        errors.push(`fund ${setting.fund_id}: ${msg}`)
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
