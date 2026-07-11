// Server-side loaders that adapt DB rows into the pure-logic inputs. Kept out of
// the route files so capital-accounts, reconciliation, and statements all derive
// from the same posted-ledger snapshot. Everything is scoped to one vehicle
// (fund_id + portfolio_group).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Account, AccountType, Posting } from './types'
import type { CapitalPosting } from './capital-account'
import { vehicleIdByName } from './vehicle-id'

export type SourcedPosting = Posting & { sourceType: string | null }

export interface LoadedLedger {
  accounts: Account[]
  postings: Posting[]
  capitalPostings: CapitalPosting[]
  /** Every posting tagged with its entry's source_type (for the cash-flow statement). */
  sourcedPostings: SourcedPosting[]
}

/**
 * Load a vehicle's chart of accounts and every posting on a POSTED journal entry
 * (drafts and voids excluded). Pass `asOf` (ISO date) to include only entries on
 * or before that date — the basis for viewing statements as of any date.
 */
export async function loadPostedLedger(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  asOf?: string
): Promise<LoadedLedger> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  let entriesQ = admin.from('journal_entries' as any).select('id, source_type, status').eq('fund_id', fundId).eq('vehicle_id', vehicleId).eq('status', 'posted')
  if (asOf) entriesQ = entriesQ.lte('entry_date', asOf)

  const [{ data: acctRows }, { data: entryRows }, { data: postingRows }] = await Promise.all([
    admin.from('chart_of_accounts' as any).select('id, code, name, type, subtype, lp_entity_id').eq('fund_id', fundId).eq('vehicle_id', vehicleId),
    entriesQ,
    admin.from('journal_postings' as any).select('journal_entry_id, account_id, amount, currency, lp_entity_id').eq('fund_id', fundId).eq('vehicle_id', vehicleId),
  ])

  const accounts: Account[] = ((acctRows as any[]) ?? []).map(a => ({
    id: a.id,
    fundId,
    code: a.code,
    name: a.name,
    type: a.type as AccountType,
    subtype: a.subtype ?? null,
    lpEntityId: a.lp_entity_id ?? null,
  }))

  const sourceByEntry = new Map<string, string | null>(
    ((entryRows as any[]) ?? []).map(e => [e.id as string, (e.source_type ?? null) as string | null])
  )

  // LP capital accounts carry lp_entity_id on the account itself. Only postings to
  // THOSE accounts belong in the capital-account roll-forward — a posting can also
  // carry an lp_entity_id on a non-capital account (e.g. the per-LP capital-call
  // receivable), which must not be mistaken for a capital movement.
  const lpCapitalAccountIds = new Set(accounts.filter(a => a.lpEntityId).map(a => a.id))

  const postings: Posting[] = []
  const capitalPostings: CapitalPosting[] = []
  const sourcedPostings: SourcedPosting[] = []
  for (const p of ((postingRows as any[]) ?? [])) {
    if (!sourceByEntry.has(p.journal_entry_id)) continue
    const amount = Number(p.amount)
    const sourceType = sourceByEntry.get(p.journal_entry_id) ?? null
    postings.push({ accountId: p.account_id, amount, currency: p.currency ?? 'USD', lpEntityId: p.lp_entity_id ?? null })
    sourcedPostings.push({ accountId: p.account_id, amount, currency: p.currency ?? 'USD', lpEntityId: p.lp_entity_id ?? null, sourceType })
    if (p.lp_entity_id && lpCapitalAccountIds.has(p.account_id)) {
      capitalPostings.push({ lpEntityId: p.lp_entity_id, amount, sourceType })
    }
  }

  return { accounts, postings, capitalPostings, sourcedPostings }
}

/** Names for the vehicle's LP entities (those with a commitment in this group). */
export async function loadEntityNames(
  admin: SupabaseClient,
  fundId: string,
  group: string
): Promise<Map<string, string>> {
  const { data: inv } = await admin
    .from('lp_investments' as any)
    .select('entity_id')
    .eq('fund_id', fundId)
    .eq('portfolio_group', group)
  const entityIds = Array.from(new Set(((inv as any[]) ?? []).map(r => r.entity_id)))
  const out = new Map<string, string>()
  if (entityIds.length === 0) return out

  const { data } = await admin.from('lp_entities' as any).select('id, entity_name').in('id', entityIds)
  for (const e of ((data as any[]) ?? [])) out.set(e.id, e.entity_name ?? e.id)
  return out
}

/**
 * Committed capital per LP entity in this vehicle — the pro-rata basis for the
 * allocation engine and opening balances.
 */
export async function loadOwnership(
  admin: SupabaseClient,
  fundId: string,
  group: string
): Promise<{ lpEntityId: string; commitment: number; paidIn: number; distributions: number }[]> {
  const { data } = await admin
    .from('lp_investments' as any)
    .select('entity_id, commitment, paid_in_capital, distributions')
    .eq('fund_id', fundId)
    .eq('portfolio_group', group)
  const byEntity = new Map<string, { commitment: number; paidIn: number; distributions: number }>()
  for (const row of ((data as any[]) ?? [])) {
    const cur = byEntity.get(row.entity_id) ?? { commitment: 0, paidIn: 0, distributions: 0 }
    cur.commitment += Number(row.commitment ?? 0)
    cur.paidIn += Number(row.paid_in_capital ?? 0)
    cur.distributions += Number(row.distributions ?? 0)
    byEntity.set(row.entity_id, cur)
  }
  return Array.from(byEntity.entries()).map(([lpEntityId, v]) => ({ lpEntityId, ...v }))
}

/** Distinct vehicles (portfolio_groups) for a fund, from LP + cash-flow data. */
export async function listVehicles(admin: SupabaseClient, fundId: string): Promise<string[]> {
  // Source of truth: the fund_vehicles registry (active vehicles).
  const { data: vrows } = await admin
    .from('fund_vehicles' as any)
    .select('name')
    .eq('fund_id', fundId)
    .eq('active', true)
    .order('name')
  const names = ((vrows as any[]) ?? []).map(r => r.name as string).filter(Boolean)
  if (names.length > 0) return names

  // Fallback for funds not yet migrated into the registry: the legacy union of
  // distinct portfolio_group strings across the vehicle-scoped tables.
  const [{ data: inv }, { data: cfg }, { data: cf }] = await Promise.all([
    admin.from('lp_investments' as any).select('portfolio_group').eq('fund_id', fundId),
    admin.from('fund_group_config' as any).select('portfolio_group').eq('fund_id', fundId),
    admin.from('fund_cash_flows' as any).select('portfolio_group').eq('fund_id', fundId),
  ])
  const set = new Set<string>()
  for (const rows of [inv, cfg, cf]) for (const r of ((rows as any[]) ?? [])) if (r.portfolio_group) set.add(r.portfolio_group)
  return Array.from(set).sort()
}
