import type { PriceFeed } from '../quotes'
import type { QuoteProvider, QuoteResult, ProviderContext } from './types'
import { googleSheetsProvider } from './google-sheets'

export type { QuoteProvider, QuoteResult, ProviderContext } from './types'
export { parseQuoteSheet, SHEET_TEMPLATE, sheetKeysFor } from './google-sheets'

/**
 * Quotes come from somewhere, and which somewhere is a per-feed setting rather than a build-time
 * decision. `price_feeds.provider` names the adapter; adding a vendor is a new file and one
 * entry here, not a migration and not a change to any valuation code.
 *
 * 'manual' is a real provider, not a placeholder: a fund entering its own period-end prices is
 * a legitimate and fully supported configuration, and the close treats those observations
 * exactly like fetched ones. It fetches nothing, so a manual feed is simply never asked.
 */
const manualProvider: QuoteProvider = {
  name: 'manual',
  async fetch() { return new Map<string, QuoteResult>() },
}

const PROVIDERS: Record<string, QuoteProvider> = {
  manual: manualProvider,
  google_sheets: googleSheetsProvider,
}

export const PROVIDER_NAMES = Object.keys(PROVIDERS)

export function providerFor(name: string | null | undefined): QuoteProvider {
  return PROVIDERS[name ?? 'manual'] ?? manualProvider
}

export interface ResolvedQuote extends QuoteResult {
  feedId: string
}

/**
 * Fetch quotes for a set of feeds, grouping by provider so each is called once.
 *
 * A provider that THROWS takes down only its own group — the others still return. A quote run
 * is a best-effort background refresh, and one vendor's outage must not stop a fund's other
 * positions from being priced. What it must never do is invent a price to paper over the
 * failure: the feeds that could not be reached are simply absent, and the close says so.
 */
export async function resolveQuotes(
  feeds: PriceFeed[],
  ctx: ProviderContext,
  providerByFeed: Map<string, string>,
): Promise<{ quotes: ResolvedQuote[]; errors: string[] }> {
  const groups = new Map<string, PriceFeed[]>()
  for (const feed of feeds) {
    const name = providerByFeed.get(feed.id) ?? 'manual'
    if (name === 'manual') continue
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name)!.push(feed)
  }

  const quotes: ResolvedQuote[] = []
  const errors: string[] = []

  for (const [name, group] of Array.from(groups.entries())) {
    try {
      const got = await providerFor(name).fetch(group, ctx)
      for (const [feedId, quote] of Array.from(got.entries())) quotes.push({ feedId, ...quote })
    } catch (e: any) {
      errors.push(`${name}: ${e?.message ?? 'fetch failed'}`)
    }
  }

  return { quotes, errors }
}
