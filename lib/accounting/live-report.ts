// The live LP capital report — the second way to produce an LP aggregated capital report.
//
// The existing way is a SNAPSHOT: someone imports a spreadsheet and `lp_investments` rows
// are frozen at that moment. This way derives the same figures from whatever the vehicle's
// books say right now, as of any date, for BOTH kinds of vehicle:
//
//   ledger vehicles — posted journal postings on LP capital accounts
//   events vehicles — lp_capital_events, the lightweight LP-facing leg
//
// The rows this emits are shaped EXACTLY like `lp_investments` rows (one per entity per
// vehicle, same column names, same units). That is the whole trick: every existing consumer
// — portal overview, investor report PDF, Excel export, the GP snapshot page, the LP
// analyst — already knows how to aggregate rows of that shape across vehicles, through
// investor parents, and through associates look-through. Emitting the same shape means the
// live path inherits all of it instead of reimplementing it.
//
// It does NOT write anything. A live report is computed and thrown away; the stored
// snapshots stay exactly as they are, which is what makes the two comparable.

import type { SupabaseClient } from '@supabase/supabase-js'
import { computeCapitalAccounts, emptyAccount, bucketForSourceType, type CapitalAccount, type CapitalPosting } from './capital-account'
import { xirr, type CashFlow } from '@/lib/xirr'
import { loadCapitalPostings, type CapitalSource } from './capital-source'
import { loadCommitmentEvents, commitmentsAsOf, loadPartnerTerms } from './terms'
import { listVehicles, loadOwnership, loadEntityNames } from './load'
import { lookThroughAccount, associateMembers } from './look-through'
import { roundCents } from './ledger'

/** The metric half of an `lp_investments` row — same names, same units. */
export interface LiveMetrics {
  commitment: number
  called_capital: number
  paid_in_capital: number
  distributions: number
  nav: number
  total_value: number
  outstanding_balance: number
  dpi: number | null
  rvpi: number | null
  tvpi: number | null
  /**
   * Per-LP IRR, computed from their dated capital movements plus their current NAV as a
   * terminal value.
   *
   * DATED AT RECOGNITION, NOT AT THE WIRE. On a ledger vehicle a contribution is dated when the
   * CALL was issued, not when the LP's money actually landed — the cash date lives on the
   * funding entry that clears the 1300 receivable. So this is a call-dated IRR. Where LPs fund
   * promptly the two are the same; where they fund late it runs slightly high. (On an
   * events-sourced vehicle there is no ambiguity: the event date IS the cash date.)
   *
   * That is a deliberate, disclosed simplification rather than a hidden one. The alternative —
   * tracing every call to its funding entry — is a separate piece of work, and this is the same
   * basis the fund has always reported on.
   */
  irr: number | null
}

export interface LiveInvestmentRow extends LiveMetrics {
  entity_id: string
  /** The vehicle name, matching `lp_investments.portfolio_group`. */
  portfolio_group: string
  /** Which producer this row came from — surfaced so a reader knows what they're trusting. */
  source: CapitalSource
  /**
   * Set when this row is a LOOK-THROUGH: the member's share of an associate/GP vehicle's
   * position, rather than a position they hold directly. Names the associate they hold it via,
   * so a reader can tell the two apart — and so nobody mistakes one for double-counting.
   */
  lookThroughVia?: string
}

const ratio = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 10000) / 10000 : null

/**
 * Turn one LP's capital account into the metric columns.
 *
 * Sign conventions, which are easy to get wrong: a capital account is a CREDIT balance, so
 * `contributions` arrives positive and `distributions` arrives NEGATIVE. `lp_investments`
 * stores distributions as a positive cumulative figure, hence the negation.
 *
 * called vs paid-in: they are THE SAME NUMBER. Capital is recognised when it is CALLED, and
 * an LP snapshot's `paid_in_capital` means exactly that — recognised, and possibly still
 * unfunded. What differs from both is FUNDED (`called − receivable`): the cash that has
 * actually arrived. On an events vehicle there is no receivable, so all three coincide.
 *
 * This block used to claim paid-in was "cash actually received", and the code agreed — which
 * put a different meaning behind `paid_in_capital` here than in the `lp_investments` rows
 * these are deliberately shaped like, and turned every outstanding call into a phantom
 * reconciliation break.
 */
/**
 * One LP's IRR from their dated capital movements.
 *
 * Signs are from the LP's point of view: a contribution is money OUT of their pocket
 * (negative), a distribution is money back (positive), and their remaining capital is a
 * terminal inflow at the reporting date — the fund would have to hand it over if it liquidated
 * today.
 *
 * Only CASH movements count. Fees, marks and gains change the LP's NAV, and the NAV is already
 * the terminal value — including them as flows would count the same economics twice.
 */
export function lpIrr(
  postings: CapitalPosting[],
  nav: number,
  asOf: string
): number | null {
  const flows: CashFlow[] = []

  for (const p of postings) {
    if (!p.entryDate) continue
    const bucket = bucketForSourceType(p.sourceType)
    if (bucket !== 'contributions' && bucket !== 'distributions') continue

    // capitalDelta = -amount. A contribution raises capital (+) and is cash OUT for the LP (−).
    const capitalDelta = -p.amount
    const flow = -capitalDelta
    if (flow === 0) continue
    flows.push({ date: new Date(p.entryDate), amount: flow })
  }

  if (flows.length === 0) return null
  flows.push({ date: new Date(asOf), amount: nav })

  flows.sort((a, b) => a.date.getTime() - b.date.getTime())
  const rate = xirr(flows)
  return rate == null || !Number.isFinite(rate) ? null : Math.round(rate * 10000) / 10000
}

export function deriveMetrics(
  account: CapitalAccount,
  commitment: number,
  receivable: number,
  irr: number | null = null
): LiveMetrics {
  // PAID-IN IS CALLED CAPITAL. Capital is recognized when it is CALLED, not when the cash
  // lands, and an LP snapshot uses `paid_in_capital` to mean exactly that — recognized, and
  // possibly still unfunded.
  //
  // This used to be `called − receivable` (i.e. FUNDED) while emitting it under the name
  // `paid_in_capital`, in rows shaped deliberately like `lp_investments`. So the same field
  // name meant two different things on the two sides of the live-vs-snapshot reconciliation,
  // and any LP with an outstanding call showed as a break that wasn't one. It also made DPI
  // and TVPI here disagree with the same LP's snapshot for no reason a reader could see.
  //
  // `funded` is still available — it is `called − receivable` — but it is not the
  // denominator and it is not "paid in".
  const called = roundCents(account.contributions)
  const paidIn = called
  const distributions = roundCents(-account.distributions)
  const nav = roundCents(account.ending)
  const totalValue = roundCents(nav + distributions)

  return {
    commitment: roundCents(commitment),
    called_capital: called,
    paid_in_capital: paidIn,
    distributions,
    nav,
    total_value: totalValue,
    outstanding_balance: roundCents(commitment - paidIn),
    // Denominator is paid-in (cash the LP actually put in), matching how every existing
    // read path computes these — see lib/lp-report-pdf.ts computeRow.
    dpi: ratio(distributions, paidIn),
    rvpi: ratio(nav, paidIn),
    tvpi: ratio(distributions + nav, paidIn),
    irr,
  }
}

/** One vehicle's live rows, plus which producer answered. */
export async function liveRowsForVehicle(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  asOf?: string
): Promise<{ source: CapitalSource; rows: LiveInvestmentRow[] }> {
  const [{ source, postings, receivableByLp }, commitmentEvents, owners] = await Promise.all([
    loadCapitalPostings(admin, fundId, group, asOf),
    loadCommitmentEvents(admin, fundId, group),
    loadOwnership(admin, fundId, group),
  ])

  // Commitment is not a ledger concept — it lives in commitment_events (effective-dated,
  // so it can be read as of the report date). Fall back to the lp_investments scalar when a
  // vehicle has no events yet, mirroring what the close does (close.ts:134-141).
  const fromEvents = commitmentsAsOf(commitmentEvents, asOf)
  const commitmentByLp = fromEvents.size > 0
    ? fromEvents
    : new Map(owners.map(o => [o.lpEntityId, o.commitment]))

  const accountByLp = computeCapitalAccounts(postings)

  // Union: an LP with a commitment but no activity still belongs on the report (they show
  // as fully unfunded), and an LP with activity but no recorded commitment must not vanish.
  const ids = new Set<string>([
    ...Array.from(accountByLp.keys()),
    ...Array.from(commitmentByLp.keys()),
  ])

  // Each LP's own postings, for their IRR. Grouped once rather than filtering per LP.
  const postingsByLp = new Map<string, CapitalPosting[]>()
  for (const p of postings) {
    if (!p.lpEntityId) continue
    const list = postingsByLp.get(p.lpEntityId) ?? []
    list.push(p)
    postingsByLp.set(p.lpEntityId, list)
  }

  const irrDate = asOf ?? new Date().toISOString().slice(0, 10)

  const rows = Array.from(ids).map(entityId => {
    const account = accountByLp.get(entityId) ?? emptyAccount()
    return {
      entity_id: entityId,
      portfolio_group: group,
      source,
      ...deriveMetrics(
        account,
        commitmentByLp.get(entityId) ?? 0,
        receivableByLp.get(entityId) ?? 0,
        lpIrr(postingsByLp.get(entityId) ?? [], account.ending, irrDate),
      ),
    }
  })
  return { source, rows }
}

export interface LiveReport {
  asOf: string | null
  rows: LiveInvestmentRow[]
  /** Per-vehicle provenance, so the UI can say where each number came from. */
  vehicles: { group: string; source: CapitalSource; lps: number }[]
  /** entity_id -> display name, for rendering without a second round-trip. */
  entityNames: Map<string, string>
}

interface AssociateLink {
  /** The associate vehicle's own name (where its members' books live). */
  associateGroup: string
  /** The vehicle it invests INTO. */
  servesGroup: string
  /** The lp_entity through which it holds that position. */
  entityId: string
}

/**
 * Associate/GP vehicles that hold a position in another vehicle, keyed by id — not by name.
 *
 * The old model matched free text (`lp_associates_overrides.associates_entity` had to match an
 * investor name AND a portfolio_group string), so renaming anything silently broke the
 * look-through and nobody found out until an LP's returns were wrong. `fund_vehicles` carries
 * both links as ids now: `serves_vehicle_id` (which fund) and `lp_entity_id` (as whom).
 */
async function loadAssociateLinks(admin: SupabaseClient, fundId: string): Promise<AssociateLink[]> {
  const { data } = await admin
    .from('fund_vehicles' as any)
    .select('id, name, kind, active, serves_vehicle_id, lp_entity_id')
    .eq('fund_id', fundId)
    .eq('kind', 'associate')
    .eq('active', true)

  const rows = ((data as any[]) ?? []).filter(v => v.serves_vehicle_id && v.lp_entity_id)
  if (rows.length === 0) return []

  const { data: served } = await admin
    .from('fund_vehicles' as any)
    .select('id, name')
    .eq('fund_id', fundId)
    .in('id', rows.map(r => r.serves_vehicle_id))

  const nameById = new Map(((served as any[]) ?? []).map(v => [v.id as string, v.name as string]))

  return rows
    .filter(r => nameById.has(r.serves_vehicle_id))
    .map(r => ({
      associateGroup: r.name as string,
      servesGroup: nameById.get(r.serves_vehicle_id)!,
      entityId: r.lp_entity_id as string,
    }))
}

/**
 * Explode an associate's position in the fund into its members' shares.
 *
 * Ownership comes from the associate vehicle's OWN books — the members' commitments to it.
 * Carry comes from its `partner_allocation_terms`, and can diverge from ownership entirely
 * (including members with carry points and no commitment at all).
 *
 * The associate's own row is REPLACED by the member rows, never shown alongside them — showing
 * both would double-count the same money, which is exactly the bug the old model had everywhere
 * except one page.
 */
async function applyLookThrough(
  admin: SupabaseClient,
  fundId: string,
  rows: LiveInvestmentRow[],
  asOf?: string
): Promise<LiveInvestmentRow[]> {
  const links = await loadAssociateLinks(admin, fundId)
  if (links.length === 0) return rows

  let out = rows
  for (const link of links) {
    const idx = out.findIndex(r => r.entity_id === link.entityId && r.portfolio_group === link.servesGroup)
    if (idx === -1) continue // the associate holds nothing in that vehicle — nothing to look through

    // The associate's members and their two allocations, from the associate vehicle's own books.
    const [{ postings }, commitmentEvents, terms, owners] = await Promise.all([
      loadCapitalPostings(admin, fundId, link.associateGroup, asOf),
      loadCommitmentEvents(admin, fundId, link.associateGroup),
      loadPartnerTerms(admin, fundId, link.associateGroup),
      loadOwnership(admin, fundId, link.associateGroup),
    ])

    const fromEvents = commitmentsAsOf(commitmentEvents, asOf)
    const basis = fromEvents.size > 0
      ? fromEvents
      : new Map(owners.map(o => [o.lpEntityId, o.commitment]))

    const carryWeights = new Map(
      terms
        .filter(t => t.category === 'carried_interest' && t.participates && t.weightOverride != null)
        .map(t => [t.lpEntityId, t.weightOverride as number])
    )

    const members = associateMembers(basis, carryWeights)
    if (members.length === 0) continue

    // Rebuild the associate's capital account so the look-through can split its BUCKETS —
    // the metric row alone can't, because carry has to follow points while capital follows
    // ownership.
    const assocAccounts = computeCapitalAccounts(
      (await loadCapitalPostings(admin, fundId, link.servesGroup, asOf)).postings
    )
    const assocAccount = assocAccounts.get(link.entityId)
    if (!assocAccount) continue

    const exploded = lookThroughAccount(assocAccount, members)
    const associateRow = out[idx]

    const memberRows: LiveInvestmentRow[] = Array.from(exploded.entries()).map(([entityId, account]) => ({
      entity_id: entityId,
      portfolio_group: link.servesGroup,
      source: associateRow.source,
      lookThroughVia: link.associateGroup,
      ...deriveMetrics(
        account,
        // A member's "commitment" to the fund is their share of the associate's commitment to it.
        roundCents(associateRow.commitment * ownershipShare(members, entityId)),
        0
      ),
    }))

    // DROP TWO THINGS, or the same money is counted twice.
    //
    //  1. The associate's OWN row in the fund — the member rows now represent it.
    //
    //  2. Every row of the ASSOCIATE VEHICLE ITSELF. A member's capital account on the
    //     associate's books IS their share of the associate's position in the fund — the GP
    //     entity's `1500 Investment in Fund` reconciles to its capital-account balance on the
    //     fund's books. Emitting both the member's capital in the associate AND their
    //     looked-through share of what the associate holds reports the same economics twice, and
    //     it would look entirely plausible: two rows, two vehicles, double the money.
    //
    // The look-through row is the one to keep, because it puts the member where they belong —
    // in the fund, alongside the direct LPs, which is the whole point of doing this.
    out = out.filter(r => r !== associateRow && r.portfolio_group !== link.associateGroup)
    out = [...out, ...memberRows]
  }

  return out
}

function ownershipShare(members: { lpEntityId: string; ownershipWeight: number }[], id: string): number {
  const total = members.reduce((s, m) => s + Math.max(0, m.ownershipWeight), 0)
  if (total <= 0) return 0
  const mine = members.find(m => m.lpEntityId === id)?.ownershipWeight ?? 0
  return Math.max(0, mine) / total
}

/**
 * The whole fund, live: every vehicle, every LP, as of a date (default: today / all data).
 *
 * This is the aggregate report. An LP holding across three vehicles gets three rows, exactly
 * as they would in a stored snapshot — the cross-vehicle roll-up is then done by the same
 * consumer code that already does it for snapshots.
 */
export async function generateLiveReport(
  admin: SupabaseClient,
  fundId: string,
  asOf?: string
): Promise<LiveReport> {
  const groups = await listVehicles(admin, fundId)

  const perVehicle = await Promise.all(
    groups.map(async group => {
      const [{ source, rows }, names] = await Promise.all([
        liveRowsForVehicle(admin, fundId, group, asOf),
        loadEntityNames(admin, fundId, group),
      ])
      return { group, source, rows, names }
    })
  )

  const entityNames = new Map<string, string>()
  for (const v of perVehicle) {
    for (const [id, name] of Array.from(v.names.entries())) entityNames.set(id, name)
  }

  // Look through any associate/GP vehicle: its position in the fund becomes its members'
  // positions. This is what puts a member who invests via the GP entity into the LP report at
  // all — before, they simply weren't in it.
  const rows = await applyLookThrough(admin, fundId, perVehicle.flatMap(v => v.rows), asOf)

  // Members surfaced by the look-through may not be named in any vehicle's roster.
  const missing = rows.map(r => r.entity_id).filter(id => !entityNames.has(id))
  if (missing.length > 0) {
    const { data } = await admin
      .from('lp_entities' as any)
      .select('id, entity_name')
      .eq('fund_id', fundId)
      .in('id', Array.from(new Set(missing)))
    for (const e of ((data as any[]) ?? [])) entityNames.set(e.id, e.entity_name)
  }

  return {
    asOf: asOf ?? null,
    rows,
    vehicles: perVehicle.map(v => ({ group: v.group, source: v.source, lps: v.rows.length })),
    entityNames,
  }
}
