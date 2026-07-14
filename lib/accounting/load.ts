// Server-side loaders that adapt DB rows into the pure-logic inputs. Kept out of
// the route files so capital-accounts, reconciliation, and statements all derive
// from the same posted-ledger snapshot. Everything is scoped to one vehicle
// (fund_id + portfolio_group).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Account, AccountType, Posting } from './types'
import type { CapitalPosting } from './capital-account'
import { vehicleIdByName } from './vehicle-id'

export type SourcedPosting = Posting & { sourceType: string | null; entryId: string; memo: string | null }

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
  // entry_date rides along so the capital-account roll-forward can be scoped to a
  // statement period without a second load.
  let entriesQ = admin.from('journal_entries' as any).select('id, source_type, status, entry_date, memo').eq('fund_id', fundId).eq('vehicle_id', vehicleId).eq('status', 'posted')
  if (asOf) entriesQ = entriesQ.lte('entry_date', asOf)

  const [{ data: acctRows }, { data: entryRows }, { data: postingRows }] = await Promise.all([
    admin.from('chart_of_accounts' as any).select('id, code, name, type, subtype, lp_entity_id, company_id').eq('fund_id', fundId).eq('vehicle_id', vehicleId),
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
    companyId: a.company_id ?? null,
  }))

  const sourceByEntry = new Map<string, string | null>(
    ((entryRows as any[]) ?? []).map(e => [e.id as string, (e.source_type ?? null) as string | null])
  )
  const dateByEntry = new Map<string, string | null>(
    ((entryRows as any[]) ?? []).map(e => [e.id as string, (e.entry_date ?? null) as string | null])
  )
  const memoByEntry = new Map<string, string | null>(
    ((entryRows as any[]) ?? []).map(e => [e.id as string, (e.memo ?? null) as string | null])
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
    const entryDate = dateByEntry.get(p.journal_entry_id) ?? null
    postings.push({ accountId: p.account_id, amount, currency: p.currency ?? 'USD', lpEntityId: p.lp_entity_id ?? null, entryDate })
    sourcedPostings.push({ entryId: p.journal_entry_id, accountId: p.account_id, amount, currency: p.currency ?? 'USD', lpEntityId: p.lp_entity_id ?? null, sourceType, entryDate, memo: memoByEntry.get(p.journal_entry_id) ?? null })
    if (p.lp_entity_id && lpCapitalAccountIds.has(p.account_id)) {
      capitalPostings.push({ lpEntityId: p.lp_entity_id, amount, sourceType, entryDate })
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

/** entity_id → partner class ('lp' | 'gp') for the entities in this vehicle. */
export async function loadEntityClasses(
  admin: SupabaseClient,
  fundId: string,
  group: string
): Promise<Map<string, string>> {
  const { data: inv } = await admin
    .from('lp_investments' as any)
    .select('entity_id')
    .eq('fund_id', fundId)
    .eq('portfolio_group', group)
  const ids = Array.from(new Set(((inv as any[]) ?? []).map(r => r.entity_id)))
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const { data } = await admin.from('lp_entities' as any).select('id, partner_class').in('id', ids)
  for (const e of ((data as any[]) ?? [])) out.set(e.id, (e.partner_class as string) ?? 'lp')
  return out
}

/**
 * Committed capital per LP entity in this vehicle — the pro-rata basis for the
 * allocation engine and opening balances.
 *
 * `lp_investments` is unique per (fund, entity, group, SNAPSHOT) — one row per LP per
 * snapshot, each carrying that snapshot's cumulative-to-date figures. So these rows
 * must be DEDUPED to a single snapshot, never summed: summing multiplies every
 * commitment by the snapshot count, and paid-in/distributions (already cumulative)
 * even more obviously. We take the row from the latest snapshot by `as_of_date`,
 * matching how the LP portal picks a snapshot (lib/lp-overview.ts).
 *
 * Rows with no snapshot (the manual /api/lps/investments POST path, and the accounting
 * Add-LP path when the fund has no snapshots yet) are a fallback: used only for an
 * entity that has no snapshotted row at all, most-recently-updated first.
 */
export async function loadOwnership(
  admin: SupabaseClient,
  fundId: string,
  group: string
): Promise<Ownership[]> {
  const { data } = await admin
    .from('lp_investments' as any)
    .select('entity_id, commitment, paid_in_capital, distributions, snapshot_id, updated_at, lp_snapshots(as_of_date, created_at)')
    .eq('fund_id', fundId)
    .eq('portfolio_group', group)
  return currentOwnership((data as InvestmentRow[]) ?? [])
}

export interface Ownership {
  lpEntityId: string
  commitment: number
  paidIn: number
  distributions: number
}

/** The `lp_investments` shape `currentOwnership` needs. Supabase nests the joined
 *  snapshot as either an object or a single-element array depending on the query. */
export interface InvestmentRow {
  entity_id: string
  commitment?: number | null
  paid_in_capital?: number | null
  distributions?: number | null
  snapshot_id?: string | null
  updated_at?: string | null
  lp_snapshots?: { as_of_date?: string | null; created_at?: string | null } | { as_of_date?: string | null; created_at?: string | null }[] | null
}

/**
 * Collapse many `lp_investments` rows (one per snapshot) to one row per LP entity.
 *
 * Pure, and exported for the tests: picking the wrong row here misstates every
 * commitment-weighted number in the module, so it earns direct coverage.
 */
export function currentOwnership(rows: InvestmentRow[]): Ownership[] {
  // A snapshotted row always beats an unsnapshotted one; among snapshotted rows the
  // greatest as_of_date wins, with created_at breaking ties on same-dated snapshots.
  const rank = (row: InvestmentRow): [number, string, string] => {
    const s = row.lp_snapshots
    const snap = Array.isArray(s) ? s[0] : s
    if (!row.snapshot_id || !snap) return [0, '', String(row.updated_at ?? '')]
    return [1, String(snap.as_of_date ?? ''), String(snap.created_at ?? '')]
  }
  const beats = (a: InvestmentRow, b: InvestmentRow): boolean => {
    const [ax, ay, az] = rank(a)
    const [bx, by, bz] = rank(b)
    if (ax !== bx) return ax > bx
    if (ay !== by) return ay > by
    return az > bz
  }

  const byEntity = new Map<string, InvestmentRow>()
  for (const row of rows) {
    const cur = byEntity.get(row.entity_id)
    if (!cur || beats(row, cur)) byEntity.set(row.entity_id, row)
  }
  return Array.from(byEntity.entries()).map(([lpEntityId, row]) => ({
    lpEntityId,
    commitment: Number(row.commitment ?? 0),
    paidIn: Number(row.paid_in_capital ?? 0),
    distributions: Number(row.distributions ?? 0),
  }))
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
