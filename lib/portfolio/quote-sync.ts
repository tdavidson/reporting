import type { SupabaseClient } from '@supabase/supabase-js'
import { getAccessToken } from '@/lib/google/drive'
import { getGoogleCredentials } from '@/lib/google/credentials'
import { decrypt } from '@/lib/crypto'
import { resolveQuotes } from './quote-providers'
import { feedActiveOn, type PriceFeed } from './quotes'

// ---------------------------------------------------------------------------
// Refreshing a fund's stored quotes.
//
// This WRITES OBSERVATIONS AND NOTHING ELSE. It does not mark a position, post an entry, or
// touch the ledger — a price arriving from a provider is a fact about a market, not authority
// to restate a fund's NAV. Turning stored quotes into marks stays a deliberate act on
// /api/accounting/quote-marks, and even that only drafts.
// ---------------------------------------------------------------------------

export interface SyncResult {
  fundId: string
  fetched: number
  stored: number
  errors: string[]
}

/** Feeds worth asking a provider about today: active, and not priced by hand. */
export function syncableFeeds(feeds: PriceFeed[], providers: Map<string, string>, today: string): PriceFeed[] {
  return feeds.filter(f => feedActiveOn(f, today) && (providers.get(f.id) ?? 'manual') !== 'manual')
}

/**
 * Refresh one fund's quotes.
 *
 * Never throws. A sync is a background refresh: a fund whose Google connection has lapsed, or
 * whose sheet was deleted, must not take down the cron for every other fund. The failure is
 * recorded on `fund_settings.quote_sheet_last_error` so the UI can show it, because the
 * alternative — a feed that quietly stops updating — stays invisible until a close blocks on a
 * stale quote weeks later.
 */
export async function syncFundQuotes(
  admin: SupabaseClient,
  fundId: string,
  today: string,
): Promise<SyncResult> {
  const result: SyncResult = { fundId, fetched: 0, stored: 0, errors: [] }

  const { data: feedRows } = await (admin as any)
    .from('price_feeds').select('*').eq('fund_id', fundId)
  const rows = ((feedRows as any[]) ?? [])
  if (rows.length === 0) return result

  const feeds = rows.map(f => ({
    id: f.id,
    companyId: f.company_id,
    kind: f.kind,
    symbol: f.symbol,
    exchange: f.exchange,
    quoteCurrency: f.quote_currency,
    quoteScale: Number(f.quote_scale ?? 1),
    activeFrom: f.active_from,
    activeUntil: f.active_until,
    restrictionUntil: f.restriction_until,
    restrictionDiscount: f.restriction_discount == null ? null : Number(f.restriction_discount),
  })) as PriceFeed[]
  const providerByFeed = new Map<string, string>(rows.map(f => [f.id as string, (f.provider ?? 'manual') as string]))

  const due = syncableFeeds(feeds, providerByFeed, today)
  if (due.length === 0) return result

  const { data: settings } = await (admin as any)
    .from('fund_settings')
    .select('quote_sheet_file_id, google_refresh_token_encrypted, encryption_key_encrypted')
    .eq('fund_id', fundId)
    .maybeSingle()

  // The token is resolved LAZILY and only once: a fund whose feeds are all manual never
  // refreshes a Google token, and a provider that needs no OAuth never pays for one.
  let cached: string | null | undefined
  const accessToken = async (): Promise<string | null> => {
    if (cached !== undefined) return cached
    cached = null
    try {
      const kek = process.env.ENCRYPTION_KEY
      if (!kek || !settings?.google_refresh_token_encrypted || !settings?.encryption_key_encrypted) return cached
      const creds = await getGoogleCredentials(admin, fundId)
      if (!creds) return cached
      const dek = decrypt(settings.encryption_key_encrypted, kek)
      const refreshToken = decrypt(settings.google_refresh_token_encrypted, dek)
      cached = await getAccessToken(refreshToken, creds.clientId, creds.clientSecret)
    } catch (e: any) {
      result.errors.push(`Google authorization failed: ${e?.message ?? 'unknown error'}`)
    }
    return cached
  }

  const { quotes, errors } = await resolveQuotes(
    due,
    { fundId, quoteSheetFileId: settings?.quote_sheet_file_id ?? null, accessToken },
    providerByFeed,
  )
  result.errors.push(...errors)
  result.fetched = quotes.length

  // A quote dated in the FUTURE is refused. A sheet with a mistyped formula can return
  // tomorrow's date, and an observation ahead of the period end would be picked up by
  // `quoteAsOf` for a period it has no business pricing.
  const usable = quotes.filter(q => {
    if (q.asOfDate > today) {
      result.errors.push(`Ignored a quote dated ${q.asOfDate}, which is in the future.`)
      return false
    }
    return true
  })

  if (usable.length > 0) {
    // Upsert on (feed_id, as_of_date): re-running the sync on the same day REPLACES the day's
    // observation rather than accumulating duplicates that would then race by insertion order.
    const { error } = await (admin as any)
      .from('price_observations')
      .upsert(
        usable.map(q => ({
          fund_id: fundId,
          feed_id: q.feedId,
          as_of_date: q.asOfDate,
          price: q.price,
          basis: q.basis,
          source: providerByFeed.get(q.feedId) ?? 'manual',
        })),
        { onConflict: 'feed_id,as_of_date' },
      )
    if (error) result.errors.push(`Storing quotes failed: ${error.message}`)
    else result.stored = usable.length
  }

  await (admin as any)
    .from('fund_settings')
    .update({
      quote_sheet_synced_at: new Date().toISOString(),
      quote_sheet_last_error: result.errors.length > 0 ? result.errors.join(' · ') : null,
    })
    .eq('fund_id', fundId)

  return result
}
