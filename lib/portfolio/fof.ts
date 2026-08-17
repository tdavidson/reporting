import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Fund-of-funds surfaces are DERIVED from the data, not toggled in settings: a fund is a FoF
 * exactly when it holds at least one holding that is itself a fund.
 *
 * Why derived. A settings flag can disagree with reality in both directions — on with nothing
 * to show, off with twenty fund positions already in the books. It also adds a migration, a
 * feature key, and a support question ("why is this page missing?"). The data already answers
 * it. Same reasoning as `kind === 'associate'` selecting the GP chart in
 * app/api/accounting/turn-on/route.ts.
 */
export function deriveFofActive(input: { fundHoldingCount: number }): boolean {
  const n = input.fundHoldingCount
  return Number.isFinite(n) && n > 0
}

/** The one query behind it. Cheap — a head count on an indexed column. */
export async function loadFofActive(admin: SupabaseClient, fundId: string): Promise<boolean> {
  const { count } = await admin
    .from('companies')
    .select('id', { count: 'exact', head: true })
    .eq('fund_id', fundId)
    .eq('holding_type', 'fund')
  return deriveFofActive({ fundHoldingCount: count ?? 0 })
}
