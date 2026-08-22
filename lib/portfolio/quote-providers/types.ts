import type { PriceFeed } from '../quotes'

/**
 * A price provider: something that can say what an instrument was worth on a date.
 *
 * The interface is deliberately narrow — one method, no configuration surface — because the
 * point of the registry is that swapping vendors is not a schema change. `price_feeds.provider`
 * names the adapter; everything a provider needs beyond the feed itself arrives in the context.
 *
 * PROVIDERS RETURN AN OBSERVATION, NOT A VALUATION. They report a price and the date it belongs
 * to and nothing else: no scaling, no FX, no discount, no leveling. All of that is
 * lib/portfolio/quotes.ts, so a new provider cannot accidentally introduce a second, drifted
 * copy of the valuation rules.
 */
export interface QuoteResult {
  /** As quoted, before quote_scale and before FX — the figure on the provider's screen. */
  price: number
  /** The market date this price belongs to, NOT when it was fetched. */
  asOfDate: string
  /**
   * 'close' only for an official closing price. A delayed or live quote is 'intraday', which
   * levels the position at 2 rather than 1 — and that is the honest answer, because a
   * 20-minute-delayed quote is not the unadjusted closing price ASC 820 means by Level 1.
   */
  basis: 'close' | 'intraday' | 'indicative'
}

export interface ProviderContext {
  fundId: string
  /**
   * Whatever a registered adapter needs to authenticate — an API key, a token resolver.
   * Deliberately open: the credential model belongs to the vendor, and pinning a shape here
   * before there is a vendor would just be a guess that the first real adapter has to undo.
   * Follow the repo's existing pattern when one lands — a `*_encrypted` column on
   * `fund_settings` under the fund DEK, as the Claude and Resend keys already do.
   */
  credentials?: Record<string, unknown>
}

export interface QuoteProvider {
  name: string
  /**
   * Quotes for the given feeds, keyed by feed id. Batched rather than one-at-a-time because
   * every real provider is either rate-limited per call or returns a whole sheet anyway, and a
   * per-feed interface would make a 40-position book do 40 round trips.
   *
   * A feed the provider cannot price is simply ABSENT from the map — never guessed at, and
   * never zero. A missing quote blocks the close with a sentence; a zero would mark the
   * position to nothing and close cleanly.
   */
  fetch(feeds: PriceFeed[], ctx: ProviderContext): Promise<Map<string, QuoteResult>>
}
