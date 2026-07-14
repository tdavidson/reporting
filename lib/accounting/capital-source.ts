// Where does a vehicle's LP capital data come from?
//
// `computeCapitalAccounts()` is a pure function over `CapitalPosting[]` — it has no idea
// whether those postings came from a double-entry ledger or from a spreadsheet. That makes
// `CapitalPosting[]` the seam: give it a second producer and every downstream consumer
// (roll-forward, statement PDF, portal figures, live capital report) works identically for
// a fully-booked fund and for an SPV nobody keeps books on.
//
// Two producers, and a vehicle uses exactly ONE:
//   'ledger' — posted journal_postings on LP capital accounts. The existing path.
//   'events' — lp_capital_events, the lightweight LP-facing leg (see migration 20260714000003).
//
// Reading both and merging would double every LP's capital the moment a vehicle had any of
// each, so the source is stored explicitly on vehicle_accounting_settings rather than
// inferred from "does a chart exist?".

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CapitalPosting } from './capital-account'
import { loadPostedLedger } from './load'
import { vehicleIdByName } from './vehicle-id'
import { RECEIVABLE_CODE } from './capital-calls'
import { roundCents } from './ledger'

export type CapitalSource = 'ledger' | 'events'

/**
 * Which producer this vehicle reads from.
 *
 * Defaults to 'events' when unset — a vehicle with no settings row has never been
 * onboarded to the ledger, so its books are empty and 'ledger' could only ever report
 * zeros. 'events' at least reports what someone entered.
 */
export async function loadCapitalSource(
  admin: SupabaseClient,
  fundId: string,
  group: string
): Promise<CapitalSource> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) return 'events'
  const { data } = await admin
    .from('vehicle_accounting_settings' as any)
    .select('capital_source')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .maybeSingle()
  return (data as any)?.capital_source === 'ledger' ? 'ledger' : 'events'
}

/** The LP-facing capital movements recorded against an unbooked vehicle. */
export async function loadCapitalEvents(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  asOf?: string
): Promise<CapitalPosting[]> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) return []

  let q = admin
    .from('lp_capital_events' as any)
    .select('lp_entity_id, event_date, amount, source_type')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
  if (asOf) q = q.lte('event_date', asOf)
  const { data } = await q

  // The identity adapter this whole design is built around: an event row IS a capital
  // posting. Same debit-positive amount convention, same source_type vocabulary.
  return ((data as any[]) ?? []).map(r => ({
    lpEntityId: r.lp_entity_id as string,
    entryDate: r.event_date as string,
    amount: Number(r.amount ?? 0),
    sourceType: (r.source_type as string) ?? null,
  }))
}

export interface VehicleCapital {
  source: CapitalSource
  postings: CapitalPosting[]
  /**
   * Per-LP balance on the "Due from LPs" receivable (1300) — capital that has been CALLED
   * but not yet WIRED. `funded = called - receivable`.
   *
   * Always empty for an events vehicle: recognize-at-call is a double-entry construct, so
   * an event-sourced vehicle has no receivable staging. An event is recorded when the money
   * moves, which makes called and funded the same thing there. That is a real modelling
   * difference, not a gap — do not try to synthesise a receivable for it.
   */
  receivableByLp: Map<string, number>
}

/** Per-LP balance on the receivable account. Pure, so the ledger is loaded only once. */
export function receivablesFromLedger(
  accounts: { id: string; code: string }[],
  postings: { accountId: string; amount: number; lpEntityId?: string | null }[]
): Map<string, number> {
  const out = new Map<string, number>()
  const receivable = accounts.find(a => a.code === RECEIVABLE_CODE)
  if (!receivable) return out
  for (const p of postings) {
    if (p.accountId !== receivable.id || !p.lpEntityId) continue
    out.set(p.lpEntityId, roundCents((out.get(p.lpEntityId) ?? 0) + p.amount))
  }
  return out
}

/**
 * A vehicle's LP capital data, from whichever producer it uses. This is what an LP-capital
 * consumer should call instead of reaching for `loadPostedLedger` directly — doing so is
 * exactly what limits a report to booked vehicles only.
 *
 * `asOf` (ISO date, inclusive) scopes to activity on or before that date, so a report can
 * be generated as of any point in time from either source.
 */
export async function loadCapitalPostings(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  asOf?: string
): Promise<VehicleCapital> {
  const source = await loadCapitalSource(admin, fundId, group)
  if (source === 'ledger') {
    const { accounts, postings, capitalPostings } = await loadPostedLedger(admin, fundId, group, asOf)
    return { source, postings: capitalPostings, receivableByLp: receivablesFromLedger(accounts, postings) }
  }
  return {
    source,
    postings: await loadCapitalEvents(admin, fundId, group, asOf),
    receivableByLp: new Map(),
  }
}
