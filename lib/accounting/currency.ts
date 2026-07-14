// The fund's reporting currency — the denomination of its books.
//
// THE LEDGER IS SINGLE-CURRENCY, AND THAT IS DELIBERATE.
//
// A fund reports in one currency. A position held in another moves for two unrelated reasons:
// the company changed value, and the exchange rate changed. The chart already separates those
// (1200/4200 for the mark, 1250/4300 for the translation — see chart.ts), which is the ASC 830
// treatment. So a foreign investment is translated into the fund's currency at the point it is
// booked, and the rate movement gets its own asset and its own income line. There is never a
// posting denominated in anything but the fund's currency.
//
// This is why `assertBalanced` checks the zero-sum PER CURRENCY: not because we expect several,
// but so that a posting in the wrong one can't silently balance against the right ones.
//
// What was broken: every writer hardcoded 'USD'. A fund whose `fund_settings.currency` was EUR
// had a EUR portfolio tracker, EUR statements, EUR LP reports — and a ledger whose postings all
// claimed to be dollars. `persistEntry` now stamps the fund's currency on every posting, so a
// caller cannot get this wrong.

import type { SupabaseClient } from '@supabase/supabase-js'

/** Per-request memo. A fund's currency doesn't change mid-request, and persistEntry is hot. */
const cache = new Map<string, string>()

export async function fundCurrency(admin: SupabaseClient, fundId: string): Promise<string> {
  const hit = cache.get(fundId)
  if (hit) return hit

  const { data } = await admin
    .from('fund_settings' as any)
    .select('currency')
    .eq('fund_id', fundId)
    .maybeSingle()

  const currency = ((data as any)?.currency as string) || 'USD'
  cache.set(fundId, currency)
  return currency
}

/** Drop a fund from the cache — call after its currency setting changes. */
export function forgetFundCurrency(fundId: string): void {
  cache.delete(fundId)
}
