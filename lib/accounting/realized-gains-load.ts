import type { SupabaseClient } from '@supabase/supabase-js'
import { isLotMethod, type LotMethod } from '@/lib/portfolio/lots'
import { realizedGains, type RealizedGains } from './realized-gains'

// The database side of the realized-gains schedule: the vehicle's investment transactions, its
// companies, and the fund's lot method (fund_settings.lot_method, FIFO when unset — the same
// default the K-1 loader uses).

export async function loadRealizedGains(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  period: { start?: string | null; end?: string | null },
): Promise<RealizedGains> {
  const [{ data: txns }, { data: companies }, { data: settings }] = await Promise.all([
    admin.from('investment_transactions' as any).select('*').eq('fund_id', fundId).eq('portfolio_group', group).order('transaction_date', { ascending: true }),
    // Every holding_type on purpose: a disposal of a fund interest is a realized gain exactly as a
    // company exit is, and the schedule names the holding either way.
    admin.from('companies' as any).select('id, name, holding_type').eq('fund_id', fundId),
    (admin as any).from('fund_settings').select('lot_method').eq('fund_id', fundId).maybeSingle(),
  ])
  const raw = (settings as any)?.lot_method
  const method: LotMethod = isLotMethod(raw) ? raw : 'fifo'
  return realizedGains(((txns as any[]) ?? []), ((companies as any[]) ?? []).map(c => ({ id: c.id as string, name: (c.name as string) ?? c.id })), method, period)
}
