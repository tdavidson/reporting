// Server-side persistence helpers shared across the accounting routes. Scoped to
// one vehicle (fund_id + portfolio_group): resolve accounts, create per-LP
// capital accounts on demand, and write a balanced entry with its postings
// (rolling back the header if postings fail).

import type { SupabaseClient } from '@supabase/supabase-js'
import { lpCapitalCode } from './chart'
import { assertBalanced } from './ledger'
import { closedPeriodRanges, dateInAnyClosedPeriod } from './periods'
import { fundCurrency } from './currency'
import { vehicleIdByName } from './vehicle-id'
import type { JournalEntry } from './types'

/** code → account_id for the vehicle's chart. */
export async function accountIdByCode(admin: SupabaseClient, fundId: string, group: string): Promise<Map<string, string>> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const { data } = await admin.from('chart_of_accounts' as any).select('id, code').eq('fund_id', fundId).eq('vehicle_id', vehicleId)
  return new Map(((data as any[]) ?? []).map(a => [a.code as string, a.id as string]))
}

/** Ensure a per-LP capital account exists for each entity in this vehicle. */
export async function ensureCapitalAccounts(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  entityIds: string[]
): Promise<Map<string, string>> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const { data: existing } = await admin
    .from('chart_of_accounts' as any)
    .select('id, lp_entity_id')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .not('lp_entity_id', 'is', null)
  const map = new Map<string, string>(((existing as any[]) ?? []).map(a => [a.lp_entity_id as string, a.id as string]))

  const missing = Array.from(new Set(entityIds)).filter(id => !map.has(id))
  if (missing.length > 0) {
    // SCOPED TO THE FUND. `lp_entities` is a cross-fund table, and these ids arrive from
    // request bodies (opening balances, capital-call lines, journal posting lpEntityId, the
    // external agent's post_entry). Without the fund filter, an id belonging to another fund
    // would resolve, and we would create a chart account here literally named
    // "Partners' capital — <the other fund's LP>" — a cross-tenant name disclosure, plus a
    // foreign id planted in this fund's postings.
    const { data: ents } = await admin
      .from('lp_entities' as any)
      .select('id, entity_name')
      .eq('fund_id', fundId)
      .in('id', missing)
    const name = new Map<string, string>(((ents as any[]) ?? []).map(e => [e.id as string, e.entity_name as string]))

    // An id that didn't resolve belongs to another fund, or to nothing. Refuse rather than
    // inventing an account named after a UUID.
    const foreign = missing.filter(id => !name.has(id))
    if (foreign.length > 0) {
      throw new Error(`Unknown LP for this fund: ${foreign.join(', ')}`)
    }

    const rows = missing.map(id => ({
      fund_id: fundId,
      portfolio_group: group,
      vehicle_id: vehicleId,
      code: lpCapitalCode(id),
      name: `Partners' capital — ${name.get(id) ?? id}`,
      type: 'equity',
      subtype: 'lp_capital',
      lp_entity_id: id,
    }))
    const { data: created } = await admin.from('chart_of_accounts' as any).insert(rows).select('id, lp_entity_id')
    for (const a of ((created as any[]) ?? [])) map.set(a.lp_entity_id, a.id)
  }
  return map
}

/** Write a balanced entry and its postings for a vehicle. Returns id or error. */
export async function persistEntry(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  userId: string | null,
  entry: JournalEntry,
  status: 'draft' | 'posted' = 'posted'
): Promise<{ entryId: string } | { error: string }> {
  // DENOMINATE THE ENTRY IN THE FUND'S CURRENCY, here, at the one place everything is written.
  //
  // Every entry builder takes a `currency` and defaults it to 'USD', and no caller ever passed
  // one — so a fund reporting in EUR had EUR statements and a EUR portfolio, and a ledger whose
  // postings all claimed to be dollars. Stamping it at the choke point means a caller cannot get
  // it wrong, and a new builder cannot reintroduce the bug.
  //
  // The ledger is single-currency by design: a foreign position is translated on the way in, and
  // the rate movement lives in 1250/4300. See currency.ts.
  const currency = await fundCurrency(admin, fundId)
  entry = { ...entry, postings: entry.postings.map(p => ({ ...p, currency })) }

  try {
    assertBalanced(entry)
  } catch (e) {
    return { error: (e as Error).message }
  }

  // Locking: refuse to post into a closed period (reopen it to amend).
  const closed = await closedPeriodRanges(admin, fundId, group)
  if (dateInAnyClosedPeriod(closed, entry.entryDate)) {
    return { error: `The period covering ${entry.entryDate} is closed — reopen it to post here` }
  }

  // A vehicle name that isn't in the registry resolves to null, and `vehicle_id` is
  // nullable — so this used to write entries and postings with vehicle_id = null. Every read
  // filters `.eq('vehicle_id', ...)`, which matches nothing when null, so those rows became
  // invisible orphans: money on the books that no statement, no capital account and no
  // report would ever show again. Refuse instead.
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) {
    return { error: `Unknown vehicle "${group}" — add it in Settings before booking to it.` }
  }

  // EVERY ACCOUNT MUST BELONG TO THIS FUND *AND* THIS VEHICLE.
  //
  // `accountId` arrives from request bodies (the journal route, the external agent's
  // post_entry) and was written verbatim. The balance trigger doesn't catch a foreign account —
  // it sums amounts and never looks at which account they're on. But every statement builds
  // from THIS vehicle's chart and joins postings to it, so a leg pointed at another vehicle's
  // account is silently DROPPED from the trial balance, the balance sheet, everything. Cash
  // goes up and nothing offsets it: the books stop balancing, and the missing leg appears in no
  // report at all.
  //
  // One check here covers the journal route, the agent, and anything written later.
  const { data: ownAccounts } = await admin
    .from('chart_of_accounts' as any)
    .select('id')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
  const valid = new Set(((ownAccounts as any[]) ?? []).map(a => a.id as string))

  const foreign = entry.postings.map(p => p.accountId).filter(id => !valid.has(id))
  if (foreign.length > 0) {
    return { error: `Posting to an account that doesn't belong to ${group}: ${foreign.join(', ')}` }
  }

  // Same for the partner on a posting. `ensureCapitalAccounts` already refuses a foreign
  // lp_entity_id, but the journal and agent paths don't go through it.
  const lpIds = Array.from(new Set(entry.postings.map(p => p.lpEntityId).filter(Boolean) as string[]))
  if (lpIds.length > 0) {
    const { data: ents } = await admin
      .from('lp_entities' as any)
      .select('id')
      .eq('fund_id', fundId)
      .in('id', lpIds)
    const known = new Set(((ents as any[]) ?? []).map(e => e.id as string))
    const strangers = lpIds.filter(id => !known.has(id))
    if (strangers.length > 0) {
      return { error: `Posting to a partner who isn't in this fund: ${strangers.join(', ')}` }
    }
  }

  const { data: created, error: entryErr } = await admin
    .from('journal_entries' as any)
    .insert({
      fund_id: fundId,
      portfolio_group: group,
      vehicle_id: vehicleId,
      entry_date: entry.entryDate,
      memo: entry.memo ?? null,
      source_type: entry.sourceType ?? 'manual',
      // Ties an entry back to what produced it — the period close tags its allocation
      // entries `close:<periodId>` so reopening can find and void exactly those.
      source_ref: entry.sourceRef ?? null,
      status,
      created_by: userId,
      posted_at: status === 'posted' ? new Date().toISOString() : null,
    })
    .select('id')
    .single()
  if (entryErr) return { error: entryErr.message }

  const entryId = (created as any).id
  const { error: postErr } = await admin.from('journal_postings' as any).insert(
    entry.postings.map(p => ({
      fund_id: fundId,
      portfolio_group: group,
      vehicle_id: vehicleId,
      journal_entry_id: entryId,
      account_id: p.accountId,
      amount: p.amount,
      currency: p.currency,
      lp_entity_id: p.lpEntityId ?? null,
    }))
  )
  if (postErr) {
    await admin.from('journal_entries' as any).delete().eq('id', entryId).eq('fund_id', fundId)
    return { error: postErr.message }
  }

  return { entryId }
}
