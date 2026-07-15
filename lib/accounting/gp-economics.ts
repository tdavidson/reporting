// GP / associate entity economics: who owns what, who holds carry points, and how much
// carry each partner has accrued, been paid, and is still owed.
//
// This is the accounting-side replacement for the "GP Entity Ownership" table that lived on
// the LPs page. It computes the SAME split the live report already does — it does not
// invent a second model — and adds the one thing that genuinely did not exist: carry paid.
//
// THE TWO ECONOMICS, and why they are separate:
//
//   ownership — a member's share of the capital the vehicle contributed to the fund, and of
//               everything that follows capital (gains, fees, expenses). DERIVED from
//               commitment_events wherever there are any, because a derived number cannot
//               drift from the books. Overridable only for a vehicle that has no
//               commitments to derive from.
//
//   carry     — a member's share of the carried interest the vehicle EARNS. Independent of
//               ownership: carry points routinely diverge from committed capital, and a
//               member can hold carry while committing nothing at all. Stored in
//               partner_allocation_terms (category 'carried_interest'), which is where the
//               look-through already reads them from. There is deliberately no second home
//               for them.
//
// Accrued carry is a MARK, NOT A DEBT. The close recomputes it from NAV each period and
// posts only the delta, so it reverses on its own if NAV falls. "Accrued and unpaid" means
// "what this partner would be owed if the fund liquidated today" — not a receivable. Every
// surface built on this must say so, or a GP will believe they are owed money they are not.

import type { SupabaseClient } from '@supabase/supabase-js'
import { roundCents } from './ledger'
import { vehicleIdByName } from './vehicle-id'
import { loadCapitalPostings } from './capital-source'
import { computeCapitalAccounts, emptyAccount, type CapitalAccount } from './capital-account'
import { loadCommitmentEvents, commitmentsAsOf, loadPartnerTerms } from './terms'
import { loadEntityNames, loadOwnership } from './load'
import { associateMembers, lookThroughAccount } from './look-through'

export interface GpVehicleLink {
  /** The associate/GP vehicle. */
  vehicle: string
  vehicleId: string
  /** The fund it is the GP of. */
  servesVehicle: string
  servesVehicleId: string
  /** The lp_entity it invests through, on the served fund's books. */
  lpEntityId: string
}

export type OwnershipBasis = 'commitments' | 'override' | 'none'

export interface GpPartnerRow {
  lpEntityId: string
  name: string
  /** 0–1. Share of the vehicle's capital. */
  ownershipPct: number
  /** 0–1. Share of the vehicle's carried interest. */
  carryPct: number
  /** Raw weight as stored, so the editor round-trips what was typed. */
  ownershipWeight: number
  carryWeight: number | null
  /** This member's share of the vehicle's capital account on the fund's books. */
  capital: CapitalAccount
  /** Carry accrued to this partner — their share of the vehicle's carriedInterest bucket. */
  carryAccrued: number
  /** Carry actually paid out (the register). */
  carryPaid: number
  /** accrued − paid. A mark, not a receivable. */
  carryUnpaid: number
}

export interface CarryPayment {
  id: string
  lpEntityId: string
  date: string
  amount: number
  memo: string | null
}

export interface GpEconomics {
  link: GpVehicleLink
  /** Where the ownership split came from. */
  basis: OwnershipBasis
  /** How carry paid is sourced: 'ledger' = derived from the associate's own books;
   *  'events' = the editable carry_payments table (LP tracking). */
  source: 'ledger' | 'events'
  /** The vehicle's own position on the fund's books, before the split. */
  associate: CapitalAccount
  partners: GpPartnerRow[]
  /** The carry-payment register — only for an LP-tracking ('events') vehicle; empty for ledger. */
  payments: CarryPayment[]
  totals: { carryAccrued: number; carryPaid: number; carryUnpaid: number; ending: number }
}

/** The associate/GP vehicles in this fund that are properly linked to a fund. */
export async function loadGpLinks(admin: SupabaseClient, fundId: string): Promise<GpVehicleLink[]> {
  const { data } = await (admin as any)
    .from('fund_vehicles')
    .select('id, name, kind, active, serves_vehicle_id, lp_entity_id')
    .eq('fund_id', fundId)
    .in('kind', ['associate', 'gp'])
    .eq('active', true)

  const rows = ((data as any[]) ?? []).filter(v => v.serves_vehicle_id && v.lp_entity_id)
  if (rows.length === 0) return []

  const { data: served } = await (admin as any)
    .from('fund_vehicles')
    .select('id, name')
    .eq('fund_id', fundId)
    .in('id', rows.map(r => r.serves_vehicle_id))
  const nameById = new Map(((served as any[]) ?? []).map(v => [v.id as string, v.name as string]))

  return rows
    .filter(r => nameById.has(r.serves_vehicle_id))
    .map(r => ({
      vehicle: r.name as string,
      vehicleId: r.id as string,
      servesVehicle: nameById.get(r.serves_vehicle_id)!,
      servesVehicleId: r.serves_vehicle_id as string,
      lpEntityId: r.lp_entity_id as string,
    }))
}

/** Is this vehicle a GP/associate entity with a fund behind it? */
export async function gpLinkFor(
  admin: SupabaseClient,
  fundId: string,
  group: string,
): Promise<GpVehicleLink | null> {
  const links = await loadGpLinks(admin, fundId)
  return links.find(l => l.vehicle === group) ?? null
}

/**
 * The ownership basis for an associate vehicle's members.
 *
 * Precedence, and the reason for it:
 *   1. An explicit override, when one exists. A vehicle that keeps no capital record has
 *      nothing to derive from, so its ownership must be stated.
 *   2. Commitments on the associate's own books (commitment_events). This is what the live
 *      report's look-through uses, and a derived number cannot drift from the books.
 *   3. The legacy `lp_investments` commitment scalar, which is the fallback the look-through
 *      already carries.
 */
async function loadOwnershipBasis(
  admin: SupabaseClient,
  fundId: string,
  link: GpVehicleLink,
  asOf?: string,
): Promise<{ basis: OwnershipBasis; weights: Map<string, number> }> {
  const { data: overrides } = await (admin as any)
    .from('vehicle_partner_ownership')
    .select('lp_entity_id, ownership_weight')
    .eq('fund_id', fundId)
    .eq('vehicle_id', link.vehicleId)

  const ovr = ((overrides as any[]) ?? [])
  if (ovr.length > 0) {
    return {
      basis: 'override',
      weights: new Map(ovr.map(o => [o.lp_entity_id as string, Number(o.ownership_weight)])),
    }
  }

  const events = await loadCommitmentEvents(admin, fundId, link.vehicle)
  const fromEvents = commitmentsAsOf(events, asOf)
  if (Array.from(fromEvents.values()).some(v => v > 0)) {
    return { basis: 'commitments', weights: fromEvents }
  }

  const owners = await loadOwnership(admin, fundId, link.vehicle)
  const fromOwnership = new Map(owners.map(o => [o.lpEntityId, o.commitment]))
  if (Array.from(fromOwnership.values()).some(v => v > 0)) {
    return { basis: 'commitments', weights: fromOwnership }
  }

  return { basis: 'none', weights: new Map() }
}

/**
 * Everything the GP panel shows for one associate/GP vehicle.
 *
 * The split itself is `lookThroughAccount`, the same function the live report calls, so the
 * accounting page and the LP report can never disagree about a member's position.
 */
export async function loadGpEconomics(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  asOf?: string,
): Promise<GpEconomics | null> {
  const link = await gpLinkFor(admin, fundId, group)
  if (!link) return null

  const [{ basis, weights }, terms, names, served, own] = await Promise.all([
    loadOwnershipBasis(admin, fundId, link, asOf),
    loadPartnerTerms(admin, fundId, link.vehicle),
    loadEntityNames(admin, fundId, link.vehicle),
    // The vehicle's position is on the SERVED FUND's books, not its own — it is an LP of
    // the fund. That is where its carriedInterest bucket lives (carry ACCRUED), because that
    // is where the close credits it.
    loadCapitalPostings(admin, fundId, link.servesVehicle, asOf),
    // Carry PAID comes from the associate's OWN books. The ledger separates a member's
    // distributions into return-of-capital (source_type 'distribution') and carried-interest
    // paid (source_type 'carried_interest') — they are different economics and post to different
    // buckets. Only the carried-interest portion is carry paid.
    loadCapitalPostings(admin, fundId, link.vehicle, asOf),
  ])

  const associate = computeCapitalAccounts(served.postings).get(link.lpEntityId) ?? emptyAccount()

  // Carry points: only rows that PARTICIPATE and carry an explicit weight. The
  // 20260713000000 backfill inserted `participates = false` rows for every gp-class partner
  // on this category, so an unfiltered read would pick up weights that mean nothing.
  const carryWeights = new Map<string, number>(
    terms
      .filter(t => t.category === 'carried_interest' && t.participates && t.weightOverride != null)
      .map(t => [t.lpEntityId, Number(t.weightOverride)])
  )

  const members = associateMembers(weights, carryWeights)
  const split = lookThroughAccount(associate, members)

  // Carry PAID is sourced from whichever books this vehicle keeps:
  //   • Fund Accounting (ledger): each member's distributions on the associate's OWN ledger,
  //     rolled up per partner straight from the books — no separate register to maintain.
  //   • LP tracking (events): an explicit table of (partner, date, amount) in carry_payments,
  //     edited on the panel — the tracking equivalent of the ledger's distribution postings.
  const source = own.source
  const payments: CarryPayment[] = []
  const paidByLp = new Map<string, number>()
  if (source === 'ledger') {
    // Carry paid = the carried-interest DISTRIBUTIONS on the associate's own books, tagged
    // source_type 'carry_distribution' — kept distinct from return-of-capital distributions AND
    // from the accrual marks (which post as 'carried_interest'). A payment debits the member's
    // capital (positive posting amount); its magnitude is the carry paid. Unpaid = accrued − paid.
    for (const p of own.postings) {
      if (!p.lpEntityId || p.sourceType !== 'carry_distribution') continue
      paidByLp.set(p.lpEntityId, roundCents((paidByLp.get(p.lpEntityId) ?? 0) + p.amount))
    }
  } else {
    const { data: rows } = await (admin as any)
      .from('carry_payments')
      .select('id, lp_entity_id, paid_date, amount, memo')
      .eq('fund_id', fundId).eq('vehicle_id', link.vehicleId)
      .order('paid_date', { ascending: false })
    for (const r of ((rows as any[]) ?? [])) {
      paidByLp.set(r.lp_entity_id, (paidByLp.get(r.lp_entity_id) ?? 0) + Number(r.amount))
      payments.push({ id: r.id as string, lpEntityId: r.lp_entity_id as string, date: r.paid_date as string, amount: Number(r.amount), memo: (r.memo ?? null) as string | null })
    }
  }

  const totalOwn = members.reduce((s, m) => s + Math.max(0, m.ownershipWeight), 0)
  const totalCarry = members.reduce((s, m) => s + Math.max(0, m.carryWeight), 0)

  // Also surface members who hold ONLY names (an entity with no weight at all) — they'd be
  // invisible otherwise, and an ownership table that silently omits a partner is worse than
  // one that shows them at zero.
  const allIds = new Set<string>([...members.map(m => m.lpEntityId), ...Array.from(names.keys())])

  const partners: GpPartnerRow[] = Array.from(allIds).map(lpEntityId => {
    const m = members.find(x => x.lpEntityId === lpEntityId)
    const capital = split.get(lpEntityId) ?? emptyAccount()
    const carryAccrued = roundCents(capital.carriedInterest)
    const carryPaid = roundCents(paidByLp.get(lpEntityId) ?? 0)
    return {
      lpEntityId,
      name: names.get(lpEntityId) ?? lpEntityId,
      ownershipPct: totalOwn > 0 && m ? Math.max(0, m.ownershipWeight) / totalOwn : 0,
      carryPct: totalCarry > 0 && m ? Math.max(0, m.carryWeight) / totalCarry : 0,
      ownershipWeight: m?.ownershipWeight ?? 0,
      carryWeight: carryWeights.has(lpEntityId) ? carryWeights.get(lpEntityId)! : null,
      capital,
      carryAccrued,
      carryPaid,
      carryUnpaid: roundCents(carryAccrued - carryPaid),
    }
  }).sort((a, b) => a.name.localeCompare(b.name))

  return {
    link,
    basis,
    source,
    associate,
    partners,
    payments,
    totals: {
      carryAccrued: roundCents(partners.reduce((s, p) => s + p.carryAccrued, 0)),
      carryPaid: roundCents(partners.reduce((s, p) => s + p.carryPaid, 0)),
      carryUnpaid: roundCents(partners.reduce((s, p) => s + p.carryUnpaid, 0)),
      ending: roundCents(partners.reduce((s, p) => s + p.capital.ending, 0)),
    },
  }
}

/** Set (or clear) a partner's ownership weight override. Weight <= 0 removes the row. */
export async function setOwnershipWeight(
  admin: SupabaseClient,
  fundId: string,
  vehicleId: string,
  lpEntityId: string,
  weight: number | null,
): Promise<void> {
  if (weight == null) {
    const { error } = await (admin as any)
      .from('vehicle_partner_ownership')
      .delete()
      .eq('fund_id', fundId).eq('vehicle_id', vehicleId).eq('lp_entity_id', lpEntityId)
    if (error) throw new Error(error.message)
    return
  }
  const { error } = await (admin as any)
    .from('vehicle_partner_ownership')
    .upsert(
      { fund_id: fundId, vehicle_id: vehicleId, lp_entity_id: lpEntityId, ownership_weight: weight, updated_at: new Date().toISOString() },
      { onConflict: 'fund_id,vehicle_id,lp_entity_id' },
    )
  if (error) throw new Error(error.message)
}

/**
 * Set a partner's carry points.
 *
 * Writes `participates = true` alongside the weight, deliberately. The 20260713000000
 * backfill left `participates = false` rows on this category for every gp-class partner,
 * and the look-through ignores a weight whose row does not participate — so setting the
 * weight alone would look saved and do nothing.
 */
export async function setCarryWeight(
  admin: SupabaseClient,
  fundId: string,
  vehicleId: string,
  lpEntityId: string,
  weight: number | null,
): Promise<void> {
  const { error } = await (admin as any)
    .from('partner_allocation_terms')
    .upsert(
      {
        fund_id: fundId,
        vehicle_id: vehicleId,
        lp_entity_id: lpEntityId,
        category: 'carried_interest',
        participates: weight != null && weight > 0,
        weight_override: weight,
      },
      { onConflict: 'fund_id,vehicle_id,lp_entity_id,category' },
    )
  if (error) throw new Error(error.message)
}

export async function recordCarryPayment(
  admin: SupabaseClient,
  fundId: string,
  userId: string | null,
  input: { vehicleId: string; lpEntityId: string; paidDate: string; amount: number; memo?: string },
): Promise<{ id: string }> {
  if (!(input.amount > 0)) throw new Error('A carry payment must be a positive amount.')
  const { data, error } = await (admin as any)
    .from('carry_payments')
    .insert({
      fund_id: fundId,
      vehicle_id: input.vehicleId,
      lp_entity_id: input.lpEntityId,
      paid_date: input.paidDate,
      amount: input.amount,
      memo: input.memo ?? null,
      created_by: userId,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return { id: (data as any).id }
}

export async function deleteCarryPayment(
  admin: SupabaseClient,
  fundId: string,
  id: string,
): Promise<void> {
  const { error } = await (admin as any)
    .from('carry_payments').delete().eq('fund_id', fundId).eq('id', id)
  if (error) throw new Error(error.message)
}
