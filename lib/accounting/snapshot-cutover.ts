// Copy an LP snapshot into the vehicles as capital events — the cutover.
//
// WHAT THIS IS FOR. LP figures live in `lp_investments`: a frozen, hand-imported
// spreadsheet keyed to an `lp_snapshots` row. That is an import of what an administrator
// reported, not a set of books. This copies it into `lp_capital_events` on each vehicle,
// so `computeCapitalAccounts` — and therefore the live report, the LP statement PDF and
// the portal — derive from the vehicle itself. After the cutover, capital is TRACKED
// rather than re-imported.
//
// COPY, NOT MOVE. Nothing is deleted and the snapshot pipeline keeps every capability it
// has. The snapshot remains the thing to reconcile against; `lp_reconcile_snapshot` (the
// agent tool) exists to diff the two.
//
// THE VOCABULARY TRAP — read this before changing any of the arithmetic.
// The snapshot and the capital accounts use the same words for different things:
//
//   snapshot `paid_in_capital`  IS called capital. It is what was RECOGNIZED, and it may
//                               never have been funded. `called_capital` is the same
//                               number (the importer's own example sets both identically).
//   snapshot `outstanding_balance` is UNCALLED commitment.
//   the ledger recognizes capital AT CALL (Dr 1300 receivable / Cr LP capital); funding
//                               clears the receivable later.
//
// So `paid_in_capital` maps onto the ledger's *contributions*, and the snapshot carries no
// funded-vs-unfunded split at all. That detail starts being tracked AFTER the cutover, via
// capital calls. It cannot be back-filled from a snapshot that never recorded it, and
// inventing it would be worse than leaving it empty.

import type { SupabaseClient } from '@supabase/supabase-js'
import { roundCents } from './ledger'
import { vehicleIdByName } from './vehicle-id'
import { loadCapitalSource } from './capital-source'
import { listVehicles } from './load'

/**
 * Vehicles the cutover will never touch, by name (case-insensitive).
 *
 * A skip LIST, deliberately, and not a rule that infers which vehicles are "done" — an
 * inference that silently starts including a vehicle is precisely the failure this must
 * not have. These were reconciled by hand; copying into them would double their capital.
 *
 * The list is per-DEPLOYMENT, so it comes from `CUTOVER_SKIP_VEHICLES` (comma-separated,
 * case-insensitive) rather than living in the repo — naming a firm's vehicles in source is
 * not something an installable app should do. Unset means skip nothing, which is right for
 * a fresh install: it has no hand-reconciled vehicles to protect.
 */
export const CUTOVER_SKIP_VEHICLES = (process.env.CUTOVER_SKIP_VEHICLES ?? '')
  .split(',')
  .map(v => v.trim().toLowerCase())
  .filter(Boolean)

export function isSkippedVehicle(name: string): boolean {
  return CUTOVER_SKIP_VEHICLES.includes(name.trim().toLowerCase())
}

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

export interface SnapshotRow {
  commitment: number
  /** = called capital. May be unfunded. See the header. */
  paidInCapital: number
  /** The snapshot's own `called_capital`. Should equal paidInCapital. */
  calledCapital: number | null
  distributions: number
  /** Net asset value. May be null when the snapshot recorded `total_value` instead. */
  nav: number | null
  /** Total value = distributions + NAV. Lets NAV be recovered when `nav` itself is empty. */
  totalValue: number | null
  /** The snapshot's own uncalled figure, for cross-checking. */
  outstandingBalance: number | null
}

export type EventSourceType = 'capital_call' | 'distribution' | 'valuation'

export interface PlannedEvent {
  sourceType: EventSourceType
  /** DEBIT-POSITIVE, the `lp_capital_events` convention. A contribution is negative. */
  amount: number
  memo: string
}

export interface RowPlan {
  events: PlannedEvent[]
  /** Ending capital the events produce. Must equal the snapshot's NAV. */
  endingCapital: number
  /** Anything the operator needs to see before trusting this row. */
  warnings: string[]
}

const TOLERANCE = 0.01

/**
 * Turn one cumulative snapshot row into the capital events that reproduce it.
 *
 * A snapshot row holds CUMULATIVE figures, not transactions. Copying an LP as a single
 * `opening_balance` for their NAV would give the right BALANCE and wrong METRICS —
 * paid-in and distributions would both be zero, so DPI, RVPI and TVPI would all be wrong.
 * So the row decomposes into three events that reconstruct the same ending balance AND
 * preserve the figures the ratios are computed from:
 *
 *     ending = contributions − distributions + gains
 *            = paid_in − distributions + (nav − paid_in + distributions)
 *            = nav                                                        ✓
 *
 * The third event is a PLUG. It is the cumulative gain or loss implied by the snapshot,
 * and it is booked as a `valuation` (unrealized) because a snapshot cannot tell us how
 * much of it was realized. That is a known and deliberate approximation: it is right in
 * total and unallocated between realized and unrealized. Say so in the UI.
 */
export function planRow(row: SnapshotRow, asOf: string): RowPlan {
  const commitment = roundCents(row.commitment)

  // Paid-in IS called capital, and a snapshot may carry the figure in EITHER column — the AI
  // import maps them separately, and a source spreadsheet often has only one. So fall back
  // exactly the way the existing read path does (lp-report-pdf.ts computeRow:
  // `paid_in_capital || called_capital || 0`). Without this fallback, every row that recorded
  // the number only under `called_capital` copied over with ZERO paid-in — which is exactly
  // how a lot of capital failed to make the crossing.
  const paidInRaw = roundCents(row.paidInCapital)
  const called = row.calledCapital == null ? null : roundCents(row.calledCapital)
  const paidIn = paidInRaw !== 0 ? paidInRaw : (called ?? 0)

  const distributions = roundCents(row.distributions)

  // NAV. `nav` is the RELIABLE primitive — including a stored 0, which is a normal state (a
  // fully-realized position). `total_value` is NOT reliable: the snapshot UI derives it as
  // distributions + NAV at display time, so the stored column is often 0 even when the shown
  // total is not. So: trust `nav` whenever it is present (0 included), and fall back to
  // `total_value − distributions` ONLY when `nav` is genuinely null — and even then only if
  // total_value is sane (≥ distributions, since total_value = distributions + NAV and NAV is
  // normally ≥ 0). An earlier version treated `nav = 0` as "missing" and derived from the
  // garbage total_value, turning every realized position into a large NEGATIVE NAV.
  const nav = row.nav != null
    ? roundCents(row.nav)
    : (row.totalValue != null && row.totalValue >= distributions - TOLERANCE
        ? roundCents(row.totalValue - distributions)
        : 0)

  const gain = roundCents(nav - paidIn + distributions)

  const warnings: string[] = []

  // Warn only when BOTH columns are genuinely populated and disagree — a real data ambiguity
  // worth a human's eyes. A stored ZERO counts as unpopulated, not as a disagreement: a
  // snapshot that filled in paid-in but left called at 0 (or vice versa) is the normal case
  // the fallback already handles, and flagging it buried the handful of real conflicts under
  // a hundred false ones.
  if (paidInRaw !== 0 && called !== null && called !== 0 && Math.abs(called - paidInRaw) > TOLERANCE) {
    warnings.push(
      `called (${called}) and paid-in (${paidInRaw}) differ — they are the same figure in a snapshot. Using paid-in.`
    )
  }

  // NOTE: we deliberately do NOT cross-check the snapshot's `outstanding_balance`. The
  // cutover derives uncalled capital from commitment − called, not from that field, so a
  // stored `outstanding_balance` that disagrees changes nothing we write — and it disagrees
  // systematically (often a uniform 0), which buried the real warnings under hundreds of
  // inert ones. `outstandingBalance` stays on the row for future use, unread here.

  if (paidIn < 0) warnings.push(`negative paid-in (${paidIn})`)

  // A negative NAV almost always means the snapshot recorded a `total_value` below the
  // distributions (total value = distributions + NAV, so it can't be less) — a data-entry
  // slip on a realized position. Surface it; the number still ties, it's just wrong at the
  // source.
  if (nav < 0) warnings.push(`derived NAV is negative (${nav}) — check nav / total_value on this row`)
  if (commitment > 0 && paidIn > commitment + TOLERANCE) {
    warnings.push(`paid-in (${paidIn}) exceeds commitment (${commitment})`)
  }

  // Debit-positive: capital is a credit balance, so a contribution is NEGATIVE and a
  // distribution is POSITIVE. Getting this backwards inverts every LP's account.
  const events: PlannedEvent[] = []
  if (Math.abs(paidIn) > TOLERANCE) {
    events.push({
      sourceType: 'capital_call',
      amount: -paidIn,
      memo: `Capital recognized to ${asOf} (from snapshot)`,
    })
  }
  if (Math.abs(distributions) > TOLERANCE) {
    events.push({
      sourceType: 'distribution',
      amount: distributions,
      memo: `Distributions to ${asOf} (from snapshot)`,
    })
  }
  if (Math.abs(gain) > TOLERANCE) {
    events.push({
      sourceType: 'valuation',
      amount: -gain,
      memo: `Cumulative gain/(loss) to ${asOf} (from snapshot; not split realized vs unrealized)`,
    })
  }

  // ending = −Σ amount (capitalDelta = −amount)
  const endingCapital = roundCents(-events.reduce((s, e) => s + e.amount, 0))
  if (Math.abs(endingCapital - nav) > TOLERANCE) {
    // Should be arithmetically impossible; assert it anyway, because a silent break here
    // means every LP's NAV is wrong and nothing else would notice.
    warnings.push(`INTERNAL: reconstructed ending ${endingCapital} != snapshot NAV ${nav}`)
  }

  return { events, endingCapital, warnings }
}

// ---------------------------------------------------------------------------
// Preview / apply
// ---------------------------------------------------------------------------

export interface PlannedLp {
  lpEntityId: string
  name: string
  commitment: number
  snapshotNav: number
  endingCapital: number
  events: PlannedEvent[]
  /** True when this LP already has a commitment_events row — we won't add another. */
  hasCommitment: boolean
  warnings: string[]
}

export interface PlannedVehicle {
  vehicle: string
  vehicleId: string | null
  /** 'copy' | why it's being skipped. */
  action: 'copy' | 'skip'
  skipReason?: string
  lps: PlannedLp[]
  totalNav: number
  eventCount: number
  commitmentsToCreate: number
}

export interface CutoverPreview {
  snapshot: { id: string; name: string; asOf: string }
  vehicles: PlannedVehicle[]
  totals: { vehicles: number; lps: number; events: number; commitments: number; warnings: number }
  alreadyImported: boolean
}

interface SnapshotMeta { id: string; name: string; as_of_date: string | null }

async function loadSnapshot(admin: SupabaseClient, fundId: string, snapshotId?: string): Promise<SnapshotMeta> {
  const { data } = await (admin as any)
    .from('lp_snapshots').select('id, name, as_of_date, created_at').eq('fund_id', fundId)
  const rows = ((data as any[]) ?? [])
  if (rows.length === 0) throw new Error('This fund has no LP snapshots to copy from.')
  if (snapshotId) {
    const hit = rows.find(s => s.id === snapshotId)
    if (!hit) throw new Error(`No snapshot ${snapshotId} in this fund.`)
    return hit
  }
  return rows.slice().sort((a, b) =>
    String(b.as_of_date ?? b.created_at).localeCompare(String(a.as_of_date ?? a.created_at))
  )[0]
}

/**
 * What the cutover WOULD write. Same code path as `applyCutover`, so the preview is not a
 * separate estimate that can drift from what actually happens — it IS the plan, and apply
 * just persists it.
 */
export async function previewCutover(
  admin: SupabaseClient,
  fundId: string,
  snapshotId?: string,
): Promise<CutoverPreview> {
  const snapshot = await loadSnapshot(admin, fundId, snapshotId)
  const asOf = snapshot.as_of_date ?? new Date().toISOString().slice(0, 10)

  const [{ data: invs }, { data: entities }, vehicles, { count: already }] = await Promise.all([
    (admin as any).from('lp_investments').select('*').eq('fund_id', fundId).eq('snapshot_id', snapshot.id),
    (admin as any).from('lp_entities').select('id, entity_name').eq('fund_id', fundId),
    listVehicles(admin, fundId),
    (admin as any).from('lp_capital_events')
      .select('id', { count: 'exact', head: true })
      .eq('fund_id', fundId).eq('origin_snapshot_id', snapshot.id),
  ])

  const nameByEntity = new Map<string, string>(
    ((entities as any[]) ?? []).map(e => [e.id as string, e.entity_name as string])
  )

  // `calc_generated` rows are the DERIVED associate-member rows written by
  // associates-calculate. They are the snapshot-side equivalent of the ledger's
  // look-through, which already explodes associate vehicles into members. Copying them
  // would double-count every associate's members against it.
  const rows = ((invs as any[]) ?? []).filter(r => !r.calc_generated)

  const byVehicle = new Map<string, any[]>()
  for (const r of rows) {
    const g = String(r.portfolio_group ?? '')
    if (!byVehicle.has(g)) byVehicle.set(g, [])
    byVehicle.get(g)!.push(r)
  }

  const planned: PlannedVehicle[] = []

  for (const vehicle of Array.from(new Set([...Array.from(byVehicle.keys()), ...vehicles]))) {
    const vRows = byVehicle.get(vehicle) ?? []
    const vehicleId = await vehicleIdByName(admin, fundId, vehicle).catch(() => null)

    const base = { vehicle, vehicleId, lps: [] as PlannedLp[], totalNav: 0, eventCount: 0, commitmentsToCreate: 0 }

    if (isSkippedVehicle(vehicle)) {
      planned.push({ ...base, action: 'skip', skipReason: 'On the skip list — reconciled by hand already.' })
      continue
    }
    if (!vehicleId) {
      planned.push({ ...base, action: 'skip', skipReason: 'No matching vehicle in the registry.' })
      continue
    }
    if (vRows.length === 0) {
      planned.push({ ...base, action: 'skip', skipReason: 'No rows for this vehicle in the snapshot.' })
      continue
    }

    const source = await loadCapitalSource(admin, fundId, vehicle)
    if (source === 'ledger') {
      planned.push({
        ...base,
        action: 'skip',
        skipReason: 'Already on the ledger — it has books. Copying would duplicate its capital.',
      })
      continue
    }

    // Commitments already exist for most LPs: migration 20260713000000 backfilled
    // commitment_events from lp_investments at 1970-01-01. Adding another would double the
    // commitment, and commitments are signed DELTAS — so check first.
    const { data: existing } = await (admin as any)
      .from('commitment_events')
      .select('lp_entity_id')
      .eq('fund_id', fundId)
      .eq('vehicle_id', vehicleId)
    const hasCommitment = new Set(((existing as any[]) ?? []).map(e => e.lp_entity_id as string))

    const lps: PlannedLp[] = []
    for (const r of vRows) {
      const plan = planRow({
        commitment: Number(r.commitment ?? 0),
        paidInCapital: Number(r.paid_in_capital ?? 0),
        calledCapital: r.called_capital == null ? null : Number(r.called_capital),
        distributions: Number(r.distributions ?? 0),
        nav: r.nav == null ? null : Number(r.nav),
        totalValue: r.total_value == null ? null : Number(r.total_value),
        outstandingBalance: r.outstanding_balance == null ? null : Number(r.outstanding_balance),
      }, asOf)

      lps.push({
        lpEntityId: r.entity_id,
        name: nameByEntity.get(r.entity_id) ?? r.entity_id,
        commitment: roundCents(Number(r.commitment ?? 0)),
        // The ending capital the events reconstruct IS the effective NAV — the same value
        // shown as "Snapshot NAV" — so the tie-out column compares like with like, whether
        // the snapshot stored `nav` or only `total_value`.
        snapshotNav: plan.endingCapital,
        endingCapital: plan.endingCapital,
        events: plan.events,
        hasCommitment: hasCommitment.has(r.entity_id),
        warnings: plan.warnings,
      })
    }

    planned.push({
      vehicle,
      vehicleId,
      action: 'copy',
      lps: lps.sort((a, b) => a.name.localeCompare(b.name)),
      totalNav: roundCents(lps.reduce((s, l) => s + l.snapshotNav, 0)),
      eventCount: lps.reduce((s, l) => s + l.events.length, 0),
      commitmentsToCreate: lps.filter(l => !l.hasCommitment && l.commitment > 0).length,
    })
  }

  const copying = planned.filter(v => v.action === 'copy')
  return {
    snapshot: { id: snapshot.id, name: snapshot.name, asOf },
    vehicles: planned.sort((a, b) => a.vehicle.localeCompare(b.vehicle)),
    totals: {
      vehicles: copying.length,
      lps: copying.reduce((s, v) => s + v.lps.length, 0),
      events: copying.reduce((s, v) => s + v.eventCount, 0),
      commitments: copying.reduce((s, v) => s + v.commitmentsToCreate, 0),
      warnings: copying.reduce((s, v) => s + v.lps.reduce((n, l) => n + l.warnings.length, 0), 0),
    },
    // Rerunning is safe (the unique index makes it a no-op), but the operator should know.
    alreadyImported: (already ?? 0) > 0,
  }
}

export interface CutoverResult {
  snapshotId: string
  eventsWritten: number
  commitmentsWritten: number
  vehicles: string[]
  errors: string[]
}

/**
 * Write the plan. Idempotent: `lp_capital_events_origin_unique` means a second run
 * upserts the same rows rather than doubling every LP's capital.
 *
 * Reversible: `revertCutover` deletes exactly what this wrote, by `origin_snapshot_id`.
 */
export async function applyCutover(
  admin: SupabaseClient,
  fundId: string,
  userId: string | null,
  snapshotId?: string,
): Promise<CutoverResult> {
  const preview = await previewCutover(admin, fundId, snapshotId)
  const errors: string[] = []
  let eventsWritten = 0
  let commitmentsWritten = 0
  const touched: string[] = []

  for (const v of preview.vehicles) {
    if (v.action !== 'copy' || !v.vehicleId) continue

    const eventRows = v.lps.flatMap(lp =>
      lp.events.map(e => ({
        fund_id: fundId,
        vehicle_id: v.vehicleId,
        lp_entity_id: lp.lpEntityId,
        event_date: preview.snapshot.asOf,
        amount: e.amount,
        source_type: e.sourceType,
        memo: e.memo,
        origin_snapshot_id: preview.snapshot.id,
        created_by: userId,
      }))
    )

    if (eventRows.length > 0) {
      // Idempotent by DELETE-then-INSERT on this vehicle's rows from THIS snapshot, rather
      // than upsert-on-conflict. Two reasons: the origin unique index is partial (it excludes
      // hand-entered null-origin rows), and Postgres ON CONFLICT cannot target a partial
      // index; and a clean replace leaves no straggler from a prior run — e.g. a `valuation`
      // event a buggy run wrote that the corrected run no longer produces (the exact edge
      // case an upsert would have left behind). It only ever touches rows tagged to this
      // snapshot and vehicle — never hand-entered events, never another snapshot's.
      const del = await (admin as any)
        .from('lp_capital_events')
        .delete()
        .eq('fund_id', fundId)
        .eq('vehicle_id', v.vehicleId)
        .eq('origin_snapshot_id', preview.snapshot.id)
      if (del.error) { errors.push(`${v.vehicle}: ${del.error.message}`); continue }

      const { error } = await (admin as any).from('lp_capital_events').insert(eventRows)
      if (error) { errors.push(`${v.vehicle}: ${error.message}`); continue }
      eventsWritten += eventRows.length
    }

    // Only for LPs that have none — commitments are signed deltas, so a second `initial`
    // row would ADD to the commitment rather than replace it.
    const commitmentRows = v.lps
      .filter(lp => !lp.hasCommitment && lp.commitment > 0)
      .map(lp => ({
        fund_id: fundId,
        vehicle_id: v.vehicleId,
        lp_entity_id: lp.lpEntityId,
        effective_date: preview.snapshot.asOf,
        amount: lp.commitment,
        kind: 'initial',
        memo: `From snapshot "${preview.snapshot.name}"`,
      }))

    if (commitmentRows.length > 0) {
      const { error } = await (admin as any).from('commitment_events').insert(commitmentRows)
      if (error) errors.push(`${v.vehicle} commitments: ${error.message}`)
      else commitmentsWritten += commitmentRows.length
    }

    touched.push(v.vehicle)
  }

  return { snapshotId: preview.snapshot.id, eventsWritten, commitmentsWritten, vehicles: touched, errors }
}

/** Reverse an import exactly. Hand-entered events (origin_snapshot_id null) are untouched. */
export async function revertCutover(
  admin: SupabaseClient,
  fundId: string,
  snapshotId: string,
): Promise<{ deleted: number }> {
  const { data, error } = await (admin as any)
    .from('lp_capital_events')
    .delete()
    .eq('fund_id', fundId)
    .eq('origin_snapshot_id', snapshotId)
    .select('id')
  if (error) throw new Error(error.message)
  return { deleted: ((data as any[]) ?? []).length }
}
