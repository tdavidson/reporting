// Cutover bootstrap: generate a vehicle's opening capital from the LP data already in the platform
// (paid-in − distributions per LP) as of a date, booked as a posted opening-balance entry. Shared by
// the /api/accounting/bootstrap route (manual date) and the one-click turn-on flow (latest snapshot).

import type { SupabaseClient } from '@supabase/supabase-js'
import { vehicleIdByName } from './vehicle-id'
import { loadOwnership } from './load'
import { accountIdByCode, ensureCapitalAccounts, persistEntry } from './persist'
import { DEFAULT_CHART } from './chart'
import { roundCents } from './ledger'
import type { Posting, JournalEntry } from './types'

export async function bootstrapOpeningBalances(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  userId: string | null,
  entryDate: string,
): Promise<{ ok: true; entryId: string; lpCount: number; total: number } | { error: string }> {
  // Seed the default chart for this vehicle if it has none.
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  let codes = await accountIdByCode(admin, fundId, group)
  if (codes.size === 0) {
    const rows = DEFAULT_CHART.map(a => ({ fund_id: fundId, portfolio_group: group, vehicle_id: vehicleId, code: a.code, name: a.name, type: a.type, subtype: a.subtype ?? null }))
    await admin.from('chart_of_accounts' as any).insert(rows)
    codes = await accountIdByCode(admin, fundId, group)
  }

  const ownership = await loadOwnership(admin, fundId, group)
  const balances = ownership
    .map(o => ({ lpEntityId: o.lpEntityId, amount: roundCents(o.paidIn - o.distributions) }))
    .filter(b => b.amount !== 0)
  if (balances.length === 0) {
    return { error: 'No LP paid-in capital found for this vehicle — nothing to bootstrap' }
  }

  // Capital in nets against cash: the opening credits each LP's capital and debits Cash. The
  // investment purchase is booked separately (Dr Investments / Cr Cash).
  const offsetId = codes.get('1000')
  if (!offsetId) return { error: 'Chart missing account 1000 (Cash)' }
  const capMap = await ensureCapitalAccounts(admin, fundId, group, balances.map(b => b.lpEntityId))

  let total = 0
  const postings: Posting[] = []
  for (const b of balances) {
    total = roundCents(total + b.amount)
    postings.push({ accountId: capMap.get(b.lpEntityId)!, amount: -b.amount, currency: 'USD', lpEntityId: b.lpEntityId })
  }
  postings.push({ accountId: offsetId, amount: total, currency: 'USD', lpEntityId: null })

  const entry: JournalEntry = { fundId, entryDate, memo: 'Opening capital bootstrapped from LP data', sourceType: 'opening_balance', postings }
  const result = await persistEntry(admin, fundId, group, userId, entry, 'posted')
  if ('error' in result) return { error: result.error }

  return { ok: true, entryId: result.entryId, lpCount: balances.length, total }
}
