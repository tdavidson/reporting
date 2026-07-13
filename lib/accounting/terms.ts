// Allocation configuration: what the close splits P&L on, how each partner's
// commitment has changed over time, and which partners bear which categories.
//
// The pure functions here are the ones worth testing; the loaders are thin.

import type { SupabaseClient } from '@supabase/supabase-js'
import { vehicleIdByName } from './vehicle-id'
import { roundCents } from './ledger'

export type AllocationBasis = 'commitment' | 'capital_balance'

/**
 * How this vehicle's books were started.
 *   full_history — rebuilt from inception; opening balances are DERIVED from the
 *                  reconstructed history, so entering them would double-count capital.
 *   cutover      — books begin at a date with an explicit opening-balance entry.
 */
export type HistoryMode = 'full_history' | 'cutover' | null

export type AllocationCategory =
  | 'management_fee'
  | 'partnership_expense'
  | 'organizational_expense'
  | 'realized_gain'
  | 'valuation'
  | 'income'
  | 'carried_interest'

export interface PartnerTerms {
  lpEntityId: string
  category: AllocationCategory
  participates: boolean
  weightOverride: number | null
  rateOverride: number | null
}

export interface CommitmentEvent {
  lpEntityId: string
  effectiveDate: string
  amount: number
  kind: string
}

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

/**
 * Each partner's commitment as of a date — the sum of their signed deltas up to it.
 * A commitment TRANSFER is two events (−X, +X) so the fund's total is unchanged;
 * this falls out of the model rather than needing a special case.
 */
export function commitmentsAsOf(events: CommitmentEvent[], asOf?: string | null): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of events) {
    if (asOf && e.effectiveDate > asOf) continue
    out.set(e.lpEntityId, roundCents((out.get(e.lpEntityId) ?? 0) + e.amount))
  }
  return out
}

export interface WeightInput {
  lpEntityId: string
  /** Committed capital, or capital-account balance — whichever the basis says. */
  basisAmount: number
}

/**
 * The weights the close uses to split ONE category across partners.
 *
 * A partner who doesn't participate gets no weight at all, so their share
 * redistributes across everyone else — a GP entity excluded from the management fee
 * doesn't shrink the fee, it shifts it onto the LPs, which is the point.
 *
 * A `weightOverride` replaces the basis amount for that partner only (a negotiated
 * share), leaving everyone else on the basis.
 */
export function allocationWeights(
  partners: WeightInput[],
  terms: PartnerTerms[],
  category: AllocationCategory
): { lpEntityId: string; commitment: number }[] {
  const byPartner = new Map<string, PartnerTerms>()
  for (const t of terms) {
    if (t.category === category) byPartner.set(t.lpEntityId, t)
  }

  return partners
    .map(p => {
      const t = byPartner.get(p.lpEntityId)
      if (t && !t.participates) return { lpEntityId: p.lpEntityId, commitment: 0 }
      const weight = t?.weightOverride ?? p.basisAmount
      return { lpEntityId: p.lpEntityId, commitment: Math.max(0, weight) }
    })
    .filter(w => w.commitment > 0)
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/** The vehicle's allocation basis. Defaults to commitment when unset. */
export async function loadAllocationBasis(
  admin: SupabaseClient,
  fundId: string,
  group: string
): Promise<AllocationBasis> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const { data } = await admin
    .from('vehicle_accounting_settings' as any)
    .select('allocation_basis')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .maybeSingle()
  const basis = (data as any)?.allocation_basis
  return basis === 'capital_balance' ? 'capital_balance' : 'commitment'
}

/** How the vehicle's books were started. Null until the user chooses. */
export async function loadHistoryMode(
  admin: SupabaseClient,
  fundId: string,
  group: string
): Promise<HistoryMode> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const { data } = await admin
    .from('vehicle_accounting_settings' as any)
    .select('history_mode')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .maybeSingle()
  const mode = (data as any)?.history_mode
  return mode === 'full_history' || mode === 'cutover' ? mode : null
}

export async function saveHistoryMode(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  mode: HistoryMode
): Promise<{ ok: true } | { error: string }> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const { error } = await admin
    .from('vehicle_accounting_settings' as any)
    .upsert(
      { fund_id: fundId, vehicle_id: vehicleId, history_mode: mode, updated_at: new Date().toISOString() },
      { onConflict: 'fund_id,vehicle_id' }
    )
  if (error) return { error: error.message }
  return { ok: true }
}

export async function saveAllocationBasis(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  basis: AllocationBasis
): Promise<{ ok: true } | { error: string }> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const { error } = await admin
    .from('vehicle_accounting_settings' as any)
    .upsert(
      { fund_id: fundId, vehicle_id: vehicleId, allocation_basis: basis, updated_at: new Date().toISOString() },
      { onConflict: 'fund_id,vehicle_id' }
    )
  if (error) return { error: error.message }
  return { ok: true }
}

export async function loadPartnerTerms(
  admin: SupabaseClient,
  fundId: string,
  group: string
): Promise<PartnerTerms[]> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const { data } = await admin
    .from('partner_allocation_terms' as any)
    .select('lp_entity_id, category, participates, weight_override, rate_override')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
  return ((data as any[]) ?? []).map(t => ({
    lpEntityId: t.lp_entity_id,
    category: t.category,
    participates: t.participates !== false,
    weightOverride: t.weight_override == null ? null : Number(t.weight_override),
    rateOverride: t.rate_override == null ? null : Number(t.rate_override),
  }))
}

export async function savePartnerTerm(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  term: { lpEntityId: string; category: AllocationCategory; participates: boolean; weightOverride?: number | null; rateOverride?: number | null; memo?: string | null }
): Promise<{ ok: true } | { error: string }> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const { error } = await admin
    .from('partner_allocation_terms' as any)
    .upsert(
      {
        fund_id: fundId,
        vehicle_id: vehicleId,
        lp_entity_id: term.lpEntityId,
        category: term.category,
        participates: term.participates,
        weight_override: term.weightOverride ?? null,
        rate_override: term.rateOverride ?? null,
        memo: term.memo ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'fund_id,vehicle_id,lp_entity_id,category' }
    )
  if (error) return { error: error.message }
  return { ok: true }
}

/** Every commitment event for the vehicle, oldest first. */
export async function loadCommitmentEvents(
  admin: SupabaseClient,
  fundId: string,
  group: string
): Promise<CommitmentEvent[]> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const { data } = await admin
    .from('commitment_events' as any)
    .select('lp_entity_id, effective_date, amount, kind')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .order('effective_date', { ascending: true })
  return ((data as any[]) ?? []).map(e => ({
    lpEntityId: e.lp_entity_id,
    effectiveDate: e.effective_date,
    amount: Number(e.amount),
    kind: e.kind,
  }))
}

/**
 * Record a commitment change. A transfer writes BOTH legs in one call, sharing a
 * transfer_id, so the fund's total commitment can't drift.
 */
export async function recordCommitmentChange(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  userId: string | null,
  input: {
    lpEntityId: string
    effectiveDate: string
    amount: number
    /** Present = a transfer of commitment TO this partner FROM the counterparty. */
    counterpartyEntityId?: string | null
    memo?: string | null
  }
): Promise<{ ok: true } | { error: string }> {
  const { lpEntityId, effectiveDate, amount, counterpartyEntityId, memo } = input
  if (!lpEntityId || !effectiveDate) return { error: 'Partner and effective date are required' }
  if (!Number.isFinite(amount) || amount === 0) return { error: 'Amount must be a non-zero number' }

  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const base = { fund_id: fundId, vehicle_id: vehicleId, effective_date: effectiveDate, memo: memo ?? null, created_by: userId }

  if (counterpartyEntityId) {
    if (counterpartyEntityId === lpEntityId) return { error: 'Cannot transfer commitment to the same partner' }
    if (amount <= 0) return { error: 'A transfer amount must be positive' }
    const transferId = crypto.randomUUID()
    const { error } = await admin.from('commitment_events' as any).insert([
      { ...base, lp_entity_id: counterpartyEntityId, amount: -amount, kind: 'transfer_out', counterparty_entity_id: lpEntityId, transfer_id: transferId },
      { ...base, lp_entity_id: lpEntityId, amount, kind: 'transfer_in', counterparty_entity_id: counterpartyEntityId, transfer_id: transferId },
    ])
    if (error) return { error: error.message }
    return { ok: true }
  }

  const { error } = await admin.from('commitment_events' as any).insert({
    ...base,
    lp_entity_id: lpEntityId,
    amount,
    kind: amount > 0 ? 'increase' : 'decrease',
  })
  if (error) return { error: error.message }
  return { ok: true }
}
