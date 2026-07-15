// The capital-tracking producer: dated cumulative LP positions → CapitalPosting[].
//
// A tracking vehicle stores POSITIONS (lp_positions): what each LP's statement said on a
// given date — commitment, called/paid-in, distributions, NAV. This is the source of truth.
//
// Every consumer of LP capital (roll-forward, statement, live report, fund economics) speaks
// `CapitalPosting[]` — the same shape the ledger emits. So this module DERIVES postings from
// the stored positions at read time, by subtracting each LP's consecutive dated positions:
//
//   position(T) − position(T−1)  →  the movements that happened at T
//
// Summing those deltas on-or-before any date reconstructs the cumulative position at the
// latest date ≤ that date; slicing them to a window gives the period's activity. So the
// derived postings behave exactly like real movements for every downstream consumer — while
// nothing but the positions is ever stored, so there is no movement copy to drift.
//
// IRREGULAR DATES ARE FIRST-CLASS. A tracking vehicle may have positions on 3/31 and then
// 11/15 and nothing between; the delta postings land on those actual dates, so a roll-forward
// honestly spans whatever period the data covers. The statement layer labels the span rather
// than implying a regular close cadence it doesn't have.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CapitalPosting } from './capital-account'
import { vehicleIdByName } from './vehicle-id'
import { roundCents } from './ledger'

const TOLERANCE = 0.005

export interface LpPosition {
  lpEntityId: string
  asOfDate: string
  commitment: number | null
  /** = paid-in. May be null (unstated). */
  calledCapital: number | null
  distributions: number | null
  /** Reliable primitive; 0 is valid (fully realized). Null = unstated. */
  nav: number | null
  /** Reported IRR (fraction) as of this date, if stated. Not used to derive postings. */
  irr?: number | null
}

/** One entity's cumulative figures at a point, normalized to numbers. */
interface Cumulative { called: number; distributions: number; nav: number; gain: number }

function cumulativeOf(p: LpPosition): Cumulative {
  const called = roundCents(p.calledCapital ?? 0)
  const distributions = roundCents(p.distributions ?? 0)
  const nav = roundCents(p.nav ?? 0)
  // gain = NAV − contributed + distributed, the cumulative gain/(loss) implied by the position.
  return { called, distributions, nav, gain: roundCents(nav - called + distributions) }
}

/**
 * Turn a set of dated positions (for any number of entities) into delta CapitalPostings.
 *
 * Pure, so it can be pinned by a test. Positions need not be sorted or grouped; this groups
 * by entity and walks each entity's dates in order, emitting the change since the prior date.
 * The very first position for an entity emits its full cumulative figures (delta from zero) —
 * which is exactly the one-time cutover decomposition, generalized to every subsequent date.
 */
export function positionsToPostings(positions: LpPosition[]): CapitalPosting[] {
  const byEntity = new Map<string, LpPosition[]>()
  for (const p of positions) {
    if (!byEntity.has(p.lpEntityId)) byEntity.set(p.lpEntityId, [])
    byEntity.get(p.lpEntityId)!.push(p)
  }

  const out: CapitalPosting[] = []
  for (const [lpEntityId, rows] of Array.from(byEntity.entries())) {
    const sorted = rows.slice().sort((a, b) => a.asOfDate.localeCompare(b.asOfDate))
    let prev: Cumulative = { called: 0, distributions: 0, nav: 0, gain: 0 }
    for (const p of sorted) {
      const cur = cumulativeOf(p)
      const dCalled = roundCents(cur.called - prev.called)
      const dDist = roundCents(cur.distributions - prev.distributions)
      const dGain = roundCents(cur.gain - prev.gain)

      // Debit-positive, the CapitalPosting convention. Capital is a credit balance, so a
      // contribution is negative and a distribution is positive.
      if (Math.abs(dCalled) > TOLERANCE) {
        out.push({ lpEntityId, entryDate: p.asOfDate, amount: -dCalled, sourceType: 'capital_call' })
      }
      if (Math.abs(dDist) > TOLERANCE) {
        out.push({ lpEntityId, entryDate: p.asOfDate, amount: dDist, sourceType: 'distribution' })
      }
      if (Math.abs(dGain) > TOLERANCE) {
        out.push({ lpEntityId, entryDate: p.asOfDate, amount: -dGain, sourceType: 'valuation' })
      }
      prev = cur
    }
  }
  return out
}

/** Load a vehicle's stored positions, up to `asOf` (inclusive) if given. */
export async function loadPositions(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  asOf?: string
): Promise<LpPosition[]> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) return []
  let q = admin
    .from('lp_positions' as any)
    .select('lp_entity_id, as_of_date, commitment, called_capital, distributions, nav, irr')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
  if (asOf) q = q.lte('as_of_date', asOf)
  const { data } = await q
  return ((data as any[]) ?? []).map(r => ({
    lpEntityId: r.lp_entity_id as string,
    asOfDate: r.as_of_date as string,
    commitment: r.commitment == null ? null : Number(r.commitment),
    calledCapital: r.called_capital == null ? null : Number(r.called_capital),
    distributions: r.distributions == null ? null : Number(r.distributions),
    nav: r.nav == null ? null : Number(r.nav),
    irr: r.irr == null ? null : Number(r.irr),
  }))
}

/**
 * Each entity's stored IRR from its most recent position on-or-before `asOf`. Only entities that
 * actually have a stored IRR appear. Read paths prefer this over the derived IRR — a single-date
 * cutover has no time spread to imply one, so the pasted figure is what we can show.
 */
export async function latestPositionIrr(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  asOf?: string
): Promise<Map<string, number>> {
  const positions = await loadPositions(admin, fundId, group, asOf)
  const latest = new Map<string, LpPosition>()
  for (const p of positions) {
    const cur = latest.get(p.lpEntityId)
    if (!cur || p.asOfDate.localeCompare(cur.asOfDate) > 0) latest.set(p.lpEntityId, p)
  }
  const out = new Map<string, number>()
  for (const [id, p] of Array.from(latest.entries())) {
    if (p.irr != null) out.set(id, p.irr)
  }
  return out
}

/** The tracking producer: dated positions → CapitalPosting[]. Wired into loadCapitalPostings. */
export async function loadPositionPostings(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  asOf?: string
): Promise<CapitalPosting[]> {
  return positionsToPostings(await loadPositions(admin, fundId, group, asOf))
}

/** Each entity's latest commitment, from its most recent position on-or-before `asOf`. */
export async function commitmentsFromPositions(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  asOf?: string
): Promise<Map<string, number>> {
  const positions = await loadPositions(admin, fundId, group, asOf)
  const latest = new Map<string, LpPosition>()
  for (const p of positions) {
    const cur = latest.get(p.lpEntityId)
    if (!cur || p.asOfDate.localeCompare(cur.asOfDate) > 0) latest.set(p.lpEntityId, p)
  }
  const out = new Map<string, number>()
  for (const [id, p] of Array.from(latest.entries())) {
    if (p.commitment != null) out.set(id, roundCents(p.commitment))
  }
  return out
}

/** The distinct as-of dates a vehicle has positions for, ascending — the record over time. */
export async function positionDates(
  admin: SupabaseClient,
  fundId: string,
  group: string
): Promise<string[]> {
  const positions = await loadPositions(admin, fundId, group)
  return Array.from(new Set(positions.map(p => p.asOfDate))).sort()
}

/**
 * When a vehicle's LP capital data was last updated — for the "data as of" footnote on
 * reports. Source-aware: the latest dated position for a tracking vehicle, the latest posted
 * journal entry for a ledger one. Null when the vehicle has no data yet.
 *
 * This matters most on an AGGREGATED report spanning many vehicles, where some are updated
 * every quarter and others only sporadically — so the footnote states it PER VEHICLE rather
 * than implying one report-wide "as of".
 */
export async function lastDataDate(
  admin: SupabaseClient,
  fundId: string,
  group: string
): Promise<string | null> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) return null

  const { data: settings } = await admin
    .from('vehicle_accounting_settings' as any)
    .select('capital_source').eq('fund_id', fundId).eq('vehicle_id', vehicleId).maybeSingle()
  const isLedger = (settings as any)?.capital_source === 'ledger'

  if (isLedger) {
    const { data } = await admin
      .from('journal_entries' as any)
      .select('entry_date')
      .eq('fund_id', fundId).eq('vehicle_id', vehicleId).eq('status', 'posted')
      .order('entry_date', { ascending: false }).limit(1).maybeSingle()
    return (data as any)?.entry_date ?? null
  }

  const { data } = await admin
    .from('lp_positions' as any)
    .select('as_of_date')
    .eq('fund_id', fundId).eq('vehicle_id', vehicleId)
    .order('as_of_date', { ascending: false }).limit(1).maybeSingle()
  return (data as any)?.as_of_date ?? null
}

/** Last-updated date per vehicle NAME, for a report spanning several vehicles. */
export async function lastDataDates(
  admin: SupabaseClient,
  fundId: string,
  groups: string[]
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  await Promise.all(groups.map(async g => { out.set(g, await lastDataDate(admin, fundId, g)) }))
  return out
}
