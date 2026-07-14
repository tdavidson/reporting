// Per-investment ledger accounts, bootstrap, and marks.
//
// Each company the vehicle holds gets its own set of accounts:
//   1100-<companyId8>  Investments at cost — <Company>      (asset, subtype 'investment')
//   1200-<companyId8>  Unrealized — <Company>               (asset, subtype 'unrealized')
//   1250-<companyId8>  FX translation — <Company>           (asset, subtype 'fx_translation')
//
// so a position's carrying value is 1100 + 1200 + 1250.
//
// The third account exists because a non-USD position moves for two unrelated reasons.
// The tracker already separates them (`valuation_change_source` is 'mark' or 'fx', and
// an FX row carries `fx_value_change`), so the ledger must too — otherwise the income
// statement's "change in unrealized appreciation" silently blends how the companies
// performed with how the dollar moved, and the two can even cancel out.
//
// `scheduleOfInvestments` sums every account carrying these subtypes, so the totals are
// unchanged — but each position can now be tied out, marked, revalued for FX, or
// written off on its own.

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPostedLedger } from './load'
import { accountIdByCode, persistEntry } from './persist'
import { vehicleIdByName } from './vehicle-id'
import { buildSoiPositions, type SoiCompany, type SoiPosition } from './soi'
import { accountBalances, roundCents } from './ledger'
import type { JournalEntry, Posting } from './types'

const COST_CODE = '1100'
const UNREALIZED_CODE = '1200'
const FX_CODE = '1250'
// Interest a convertible note has EARNED but not been paid. Its own asset, per company, so it
// converts into that company's cost basis when the note converts — and so it never contaminates
// the 1100 cost tie-out against the tracker in the meantime.
const ACCRUED_INTEREST_CODE = '1150'
const CASH_CODE = '1000'
const UNREALIZED_INCOME_CODE = '4200'
const FX_INCOME_CODE = '4300'

const short = (id: string) => id.slice(0, 8)
export const investmentCostCode = (companyId: string) => `${COST_CODE}-${short(companyId)}`
export const investmentUnrealizedCode = (companyId: string) => `${UNREALIZED_CODE}-${short(companyId)}`
export const investmentFxCode = (companyId: string) => `${FX_CODE}-${short(companyId)}`
export const investmentAccruedInterestCode = (companyId: string) => `${ACCRUED_INTEREST_CODE}-${short(companyId)}`

export interface InvestmentAccounts {
  costId: string
  unrealizedId: string
  fxId: string
  /** Accrued but unpaid note interest. Absent on a chart seeded before notes were supported. */
  accruedInterestId?: string
}

/**
 * Ensure each company has its cost and unrealized accounts on this vehicle's chart.
 * Idempotent — mirrors `ensureCapitalAccounts` for LPs.
 */
export async function ensureInvestmentAccounts(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  companies: { id: string; name: string }[]
): Promise<Map<string, InvestmentAccounts>> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)

  const { data: existing } = await admin
    .from('chart_of_accounts' as any)
    .select('id, code, company_id, subtype')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .not('company_id', 'is', null)

  const assign = (cur: Partial<InvestmentAccounts>, subtype: string, id: string) => {
    if (subtype === 'investment') cur.costId = id
    if (subtype === 'unrealized') cur.unrealizedId = id
    if (subtype === 'fx_translation') cur.fxId = id
    if (subtype === 'accrued_interest') cur.accruedInterestId = id
  }

  const byCompany = new Map<string, Partial<InvestmentAccounts>>()
  for (const a of ((existing as any[]) ?? [])) {
    const cur = byCompany.get(a.company_id) ?? {}
    assign(cur, a.subtype, a.id)
    byCompany.set(a.company_id, cur)
  }

  // Additive: a company onboarded before FX accounts existed gets its 1250 backfilled
  // here rather than needing a migration.
  const rows: any[] = []
  for (const c of companies) {
    const cur = byCompany.get(c.id) ?? {}
    if (!cur.costId) {
      rows.push({
        fund_id: fundId, portfolio_group: group, vehicle_id: vehicleId,
        code: investmentCostCode(c.id), name: `Investment — ${c.name}`,
        type: 'asset', subtype: 'investment', company_id: c.id,
      })
    }
    if (!cur.unrealizedId) {
      rows.push({
        fund_id: fundId, portfolio_group: group, vehicle_id: vehicleId,
        code: investmentUnrealizedCode(c.id), name: `Unrealized — ${c.name}`,
        type: 'asset', subtype: 'unrealized', company_id: c.id,
      })
    }
    if (!cur.fxId) {
      rows.push({
        fund_id: fundId, portfolio_group: group, vehicle_id: vehicleId,
        code: investmentFxCode(c.id), name: `FX translation — ${c.name}`,
        type: 'asset', subtype: 'fx_translation', company_id: c.id,
      })
    }
    if (!cur.accruedInterestId) {
      rows.push({
        fund_id: fundId, portfolio_group: group, vehicle_id: vehicleId,
        code: investmentAccruedInterestCode(c.id), name: `Accrued interest — ${c.name}`,
        type: 'asset', subtype: 'accrued_interest', company_id: c.id,
      })
    }
  }

  if (rows.length > 0) {
    const { data: created, error } = await admin
      .from('chart_of_accounts' as any)
      .insert(rows)
      .select('id, company_id, subtype')
    if (error) throw new Error(error.message)
    for (const a of ((created as any[]) ?? [])) {
      const cur = byCompany.get(a.company_id) ?? {}
      assign(cur, a.subtype, a.id)
      byCompany.set(a.company_id, cur)
    }
  }

  const out = new Map<string, InvestmentAccounts>()
  for (const c of companies) {
    const cur = byCompany.get(c.id)
    if (cur?.costId && cur?.unrealizedId && cur?.fxId) {
      out.set(c.id, { costId: cur.costId, unrealizedId: cur.unrealizedId, fxId: cur.fxId })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Reading the ledger per company
// ---------------------------------------------------------------------------

export interface CompanyLedger {
  companyId: string
  cost: number
  /** The mark: what the position did in its OWN currency. */
  unrealized: number
  /** What the exchange rate did to it. Always 0 for a USD position. */
  fxTranslation: number
  /** cost + unrealized + fxTranslation — what the balance sheet carries. */
  carrying: number
}

/** Ledger cost, mark, and FX per company, from the per-investment accounts. */
export async function ledgerByCompany(
  admin: SupabaseClient,
  fundId: string,
  group: string
): Promise<Map<string, CompanyLedger>> {
  const { accounts, postings } = await loadPostedLedger(admin, fundId, group)
  const bal = accountBalances(postings)

  const out = new Map<string, CompanyLedger>()
  for (const a of accounts) {
    const companyId = (a as any).companyId as string | undefined
    if (!companyId) continue
    // `unrealized` and `fx_translation` are subtypes on BOTH an asset (1200/1250) and an
    // income account (4200/4300). Only the asset side is the position's carrying value.
    if (a.type !== 'asset') continue
    const cur = out.get(companyId) ?? { companyId, cost: 0, unrealized: 0, fxTranslation: 0, carrying: 0 }
    const amount = roundCents(bal.get(a.id) ?? 0)
    if (a.subtype === 'investment') cur.cost = roundCents(cur.cost + amount)
    if (a.subtype === 'unrealized') cur.unrealized = roundCents(cur.unrealized + amount)
    if (a.subtype === 'fx_translation') cur.fxTranslation = roundCents(cur.fxTranslation + amount)
    cur.carrying = roundCents(cur.cost + cur.unrealized + cur.fxTranslation)
    out.set(companyId, cur)
  }
  return out
}

// ---------------------------------------------------------------------------
// Bootstrap — bring the tracker's positions onto the ledger
// ---------------------------------------------------------------------------

export interface BootstrapPreview {
  positions: (SoiPosition & { ledgerCost: number; ledgerUnrealized: number; deltaCost: number; deltaUnrealized: number })[]
  totalCost: number
  totalUnrealized: number
  /** Aggregate investment balance already on the ledger and NOT attributed to a company. */
  unassignedCost: number
  unassignedUnrealized: number
  offsetLabel: string
  warnings: string[]
}

/**
 * What bootstrapping would book. Writes nothing.
 *
 * `offset` decides where the other side lands:
 *   'cash'    — a RECLASSIFICATION out of cash. This is the cutover case: the opening
 *               bootstrap already credited partners' capital and debited Cash for the
 *               whole NAV, so the investments must come OUT of cash, not add to equity
 *               again. Crediting capital here would double-count the fund twice over.
 *   'capital' — for a vehicle whose capital has NOT been booked yet: Cr partners'
 *               capital (opening_balance), the way an opening entry normally works.
 */
export async function previewBootstrapInvestments(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  offset: 'cash' | 'capital'
): Promise<BootstrapPreview | { error: string }> {
  const [{ data: txns }, { data: companies }] = await Promise.all([
    admin.from('investment_transactions' as any).select('*').eq('fund_id', fundId),
    admin.from('companies' as any).select('*').eq('fund_id', fundId),
  ])

  const positions = buildSoiPositions(
    ((txns as any[]) ?? []),
    ((companies as any[]) ?? []) as SoiCompany[],
    group,
  )
  if (positions.length === 0) {
    return { error: `No investments are tagged to ${group} in the portfolio tracker — nothing to bootstrap.` }
  }

  const ledger = await ledgerByCompany(admin, fundId, group)
  const { accounts, postings } = await loadPostedLedger(admin, fundId, group)
  const bal = accountBalances(postings)

  // Anything sitting on the AGGREGATE 1100/1200 (no company_id) — it would be
  // double-counted if we booked the per-company balances on top of it.
  const aggregate = accounts.filter(a => !(a as any).companyId && (a.code === COST_CODE || a.code === UNREALIZED_CODE))
  let unassignedCost = 0
  let unassignedUnrealized = 0
  for (const a of aggregate) {
    const v = roundCents(bal.get(a.id) ?? 0)
    if (a.code === COST_CODE) unassignedCost = roundCents(unassignedCost + v)
    if (a.code === UNREALIZED_CODE) unassignedUnrealized = roundCents(unassignedUnrealized + v)
  }

  const warnings: string[] = []
  if (unassignedCost !== 0 || unassignedUnrealized !== 0) {
    warnings.push(
      `The ledger already carries ${unassignedCost.toFixed(2)} of cost and ${unassignedUnrealized.toFixed(2)} of unrealized on the AGGREGATE accounts (1100/1200), not attributed to any company. ` +
      `Booking per-company balances on top would double-count them — reassign or reverse those first.`
    )
  }

  const rows = positions.map(p => {
    const l = ledger.get(p.companyId)
    const ledgerCost = l?.cost ?? 0
    const ledgerUnrealized = l?.unrealized ?? 0
    return {
      ...p,
      ledgerCost,
      ledgerUnrealized,
      deltaCost: roundCents(p.cost - ledgerCost),
      deltaUnrealized: roundCents(p.unrealized - ledgerUnrealized),
    }
  })

  return {
    positions: rows,
    totalCost: roundCents(rows.reduce((s, r) => s + r.deltaCost, 0)),
    totalUnrealized: roundCents(rows.reduce((s, r) => s + r.deltaUnrealized, 0)),
    unassignedCost,
    unassignedUnrealized,
    offsetLabel: offset === 'cash' ? 'Cash (1000)' : "Partners' capital",
    warnings,
  }
}

/**
 * Book the tracker's positions onto the ledger, per company.
 *
 * Only the DELTA is posted, so re-running is safe: a position already on the ledger
 * at the right value contributes nothing.
 */
export async function bootstrapInvestments(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  userId: string | null,
  opts: { entryDate: string; offset: 'cash' | 'capital'; force?: boolean }
): Promise<{ entryId: string; companies: number; cost: number; unrealized: number } | { error: string }> {
  const preview = await previewBootstrapInvestments(admin, fundId, group, opts.offset)
  if ('error' in preview) return preview
  if (!opts.entryDate) return { error: 'An entry date is required' }
  if (preview.warnings.length > 0 && !opts.force) {
    return { error: preview.warnings.join(' ') }
  }
  if (preview.totalCost === 0 && preview.totalUnrealized === 0) {
    return { error: 'The ledger already matches the tracker — nothing to book.' }
  }

  const accts = await ensureInvestmentAccounts(
    admin, fundId, group,
    preview.positions.map(p => ({ id: p.companyId, name: p.name })),
  )
  const codes = await accountIdByCode(admin, fundId, group)

  const postings: Posting[] = []
  for (const p of preview.positions) {
    const a = accts.get(p.companyId)
    if (!a) return { error: `Could not create accounts for ${p.name}` }
    if (p.deltaCost !== 0) postings.push({ accountId: a.costId, amount: p.deltaCost, currency: 'USD', lpEntityId: null })
    if (p.deltaUnrealized !== 0) postings.push({ accountId: a.unrealizedId, amount: p.deltaUnrealized, currency: 'USD', lpEntityId: null })
  }

  const total = roundCents(preview.totalCost + preview.totalUnrealized)

  if (opts.offset === 'cash') {
    // Reclassify OUT of cash. The cutover opening already put the whole NAV into cash
    // and credited partners' capital; crediting capital again here would book the
    // fund's equity a second time.
    const cashId = codes.get(CASH_CODE)
    if (!cashId) return { error: 'Chart is missing account 1000 (Cash)' }
    postings.push({ accountId: cashId, amount: roundCents(-total), currency: 'USD', lpEntityId: null })
  } else {
    // No capital booked yet — the investments ARE the opening position. Split across
    // LP capital accounts pro-rata is a separate concern; park it on the pooled
    // LP capital line so this stays one honest entry.
    const lpCapital = codes.get('3100')
    if (!lpCapital) return { error: "Chart is missing account 3100 (Partners' capital)" }
    postings.push({ accountId: lpCapital, amount: roundCents(-total), currency: 'USD', lpEntityId: null })
  }

  const entry: JournalEntry = {
    fundId,
    entryDate: opts.entryDate,
    memo: `Opening investment position — ${preview.positions.length} ${preview.positions.length === 1 ? 'company' : 'companies'} from the portfolio tracker`,
    sourceType: 'opening_balance',
    postings,
  }

  const result = await persistEntry(admin, fundId, group, userId, entry, 'posted')
  if ('error' in result) return { error: result.error }

  return {
    entryId: result.entryId,
    companies: preview.positions.length,
    cost: preview.totalCost,
    unrealized: preview.totalUnrealized,
  }
}

// ---------------------------------------------------------------------------
// Replaying the tracker's dated history
// ---------------------------------------------------------------------------
//
// The tracker's rows are DATED — purchases, round_info price changes, mark events,
// proceeds. Bootstrapping a single lump entry collapses all of that onto one date,
// which then allocates every historical gain into whichever month you bootstrapped.
// Replaying the history books each change on the date it actually happened, so the
// income statement shows the gain in the right period and the close allocates it to
// whoever held capital at the time.

export interface InvestmentEvent {
  date: string
  companyId: string
  companyName: string
  /** Change in cost basis on this date (a purchase, or basis retired on an exit). */
  costDelta: number
  /** Change in carrying value on this date. */
  carryingDelta: number
  /** The MARK only — the position moving in its own currency. Excludes the rate move. */
  unrealizedDelta: number
  /** The rate move only. Zero for a USD position. */
  fxDelta: number
}

export interface HistoryPreview {
  events: InvestmentEvent[]
  dates: string[]
  totalCost: number
  totalUnrealized: number
  totalFx: number
  warnings: string[]
}

/** Positions as the tracker saw them on a date — everything up to and including it. */
function positionsAsOf(txns: any[], companies: SoiCompany[], group: string, date: string): SoiPosition[] {
  const upTo = txns.filter(t => !t.transaction_date || t.transaction_date <= date)
  return buildSoiPositions(upTo, companies, group, new Date(`${date}T00:00:00Z`))
}

/**
 * How much of a company's value change on a date was the exchange rate rather than the
 * company. The tracker stamps `valuation_change_source = 'fx'` on a revaluation row and
 * puts the fund-currency delta in `fx_value_change`, so this is a lookup, not a guess.
 *
 * Legacy rows have a null source and are treated as marks — which is right: they were
 * booked before FX revaluation existed, so none of them are rate moves.
 */
function fxByCompanyDate(txns: any[], group: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const t of txns) {
    if (t.valuation_change_source !== 'fx') continue
    if (t.portfolio_group && t.portfolio_group !== group) continue
    if (!t.transaction_date || !t.company_id) continue
    const delta = Number(t.fx_value_change ?? t.unrealized_value_change ?? 0)
    if (!delta) continue
    const key = `${t.company_id}|${t.transaction_date}`
    out.set(key, roundCents((out.get(key) ?? 0) + delta))
  }
  return out
}

/**
 * Walk the tracker's timeline and work out what changed on each date. Writes nothing.
 *
 * `from` skips everything on or before a cutover date — those are already in the
 * opening position, and replaying them would double-count.
 */
export async function previewInvestmentHistory(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  opts: { from?: string | null } = {}
): Promise<HistoryPreview | { error: string }> {
  const [{ data: txnRows }, { data: companyRows }] = await Promise.all([
    admin.from('investment_transactions' as any).select('*').eq('fund_id', fundId),
    admin.from('companies' as any).select('*').eq('fund_id', fundId),
  ])
  const txns = ((txnRows as any[]) ?? [])
  const companies = ((companyRows as any[]) ?? []) as SoiCompany[]

  const finalPositions = buildSoiPositions(txns, companies, group)
  if (finalPositions.length === 0) {
    return { error: `No investments are tagged to ${group} in the portfolio tracker — nothing to replay.` }
  }

  // Every date on which anything could have changed: the vehicle's own rows, plus the
  // company-wide price signals (a round the fund didn't participate in still re-prices
  // the position).
  const relevantCompanyIds = new Set(finalPositions.map(p => p.companyId))
  const dates = Array.from(new Set(
    txns
      .filter(t => relevantCompanyIds.has(t.company_id) && t.transaction_date)
      .filter(t => t.portfolio_group === group || !t.portfolio_group)
      .map(t => t.transaction_date as string)
  )).sort()

  const fxMap = fxByCompanyDate(txns, group)
  const events: InvestmentEvent[] = []
  // `fx` is the CUMULATIVE rate effect carried on the position, so unwinding an exit
  // reverses exactly what was booked to 1250 rather than an estimate.
  const prev = new Map<string, { cost: number; carrying: number; fx: number }>()

  for (const date of dates) {
    const positions = positionsAsOf(txns, companies, group, date)
    const seen = new Set<string>()

    for (const p of positions) {
      seen.add(p.companyId)
      const before = prev.get(p.companyId) ?? { cost: 0, carrying: 0, fx: 0 }
      const costDelta = roundCents(p.cost - before.cost)
      const carryingDelta = roundCents(p.fairValue - before.carrying)
      // The rate move is known; the mark is what's left once cost and FX are removed.
      const fxDelta = fxMap.get(`${p.companyId}|${date}`) ?? 0
      if (costDelta !== 0 || carryingDelta !== 0) {
        events.push({
          date,
          companyId: p.companyId,
          companyName: p.name,
          costDelta,
          carryingDelta,
          unrealizedDelta: roundCents(carryingDelta - costDelta - fxDelta),
          fxDelta,
        })
      }
      prev.set(p.companyId, { cost: p.cost, carrying: p.fairValue, fx: roundCents(before.fx + fxDelta) })
    }

    // A position that dropped out entirely (fully exited / written to nothing) has to
    // be taken off the books, or its cost, mark and FX linger forever.
    for (const [companyId, before] of Array.from(prev.entries())) {
      if (seen.has(companyId) || (before.cost === 0 && before.carrying === 0)) continue
      const name = finalPositions.find(p => p.companyId === companyId)?.name ?? 'Investment'
      events.push({
        date,
        companyId,
        companyName: name,
        costDelta: roundCents(-before.cost),
        carryingDelta: roundCents(-before.carrying),
        unrealizedDelta: roundCents(-(before.carrying - before.cost - before.fx)),
        fxDelta: roundCents(-before.fx),
      })
      prev.set(companyId, { cost: 0, carrying: 0, fx: 0 })
    }
  }

  const kept = opts.from ? events.filter(e => e.date > opts.from!) : events

  // Guard against double-posting. This has to check the AGGREGATE 1100/1200 too, not
  // just the per-company accounts — a vehicle booked before per-company accounts
  // existed carries its whole balance there, and would silently replay on top of it.
  const warnings: string[] = []
  const { accounts, postings } = await loadPostedLedger(admin, fundId, group)
  const bal = accountBalances(postings)
  const existingInvestment = roundCents(
    accounts
      .filter(a => a.type === 'asset' && (a.subtype === 'investment' || a.subtype === 'unrealized' || a.subtype === 'fx_translation'))
      .reduce((s, a) => s + (bal.get(a.id) ?? 0), 0)
  )
  if (existingInvestment !== 0) {
    warnings.push(
      `This vehicle already carries ${existingInvestment.toFixed(2)} of investments on the ledger. ` +
      `Replaying the history would post them a second time — reverse the existing entries first, or replay only from a cutover date.`
    )
  }

  return {
    events: kept,
    dates: Array.from(new Set(kept.map(e => e.date))).sort(),
    totalCost: roundCents(kept.reduce((s, e) => s + e.costDelta, 0)),
    totalUnrealized: roundCents(kept.reduce((s, e) => s + e.unrealizedDelta, 0)),
    totalFx: roundCents(kept.reduce((s, e) => s + e.fxDelta, 0)),
    warnings,
  }
}

/**
 * Post the tracker's history to the ledger: a purchase entry, a mark entry, and an FX
 * revaluation entry per date on which each changed. Each lands on its own date, so the
 * income statement and the close see the gain in the period it belongs to — and the
 * mark and the rate move stay in separate accounts, so neither can hide the other.
 */
export async function replayInvestmentHistory(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  userId: string | null,
  opts: { from?: string | null; force?: boolean } = {}
): Promise<{ entries: number; dates: number; cost: number; unrealized: number; fx: number } | { error: string }> {
  const preview = await previewInvestmentHistory(admin, fundId, group, opts)
  if ('error' in preview) return preview
  if (preview.warnings.length > 0 && !opts.force) return { error: preview.warnings.join(' ') }
  if (preview.events.length === 0) return { error: 'Nothing to replay in that range.' }

  const names = new Map(preview.events.map(e => [e.companyId, e.companyName]))
  const accts = await ensureInvestmentAccounts(
    admin, fundId, group,
    Array.from(names.entries()).map(([id, name]) => ({ id, name })),
  )
  const codes = await accountIdByCode(admin, fundId, group)
  const cashId = codes.get(CASH_CODE)
  const incomeId = codes.get(UNREALIZED_INCOME_CODE)
  const fxIncomeId = codes.get(FX_INCOME_CODE)
  if (!cashId) return { error: 'Chart is missing account 1000 (Cash)' }
  if (!incomeId) return { error: 'Chart is missing account 4200 (Change in unrealized appreciation)' }
  // Only demanded when there's actually a rate move to book, so a USD-only fund whose
  // chart predates FX doesn't get blocked on an account it will never use.
  if (!fxIncomeId && preview.totalFx !== 0) {
    return { error: 'Chart is missing account 4300 (Foreign currency translation) — re-sync the chart of accounts' }
  }

  let entries = 0

  for (const date of preview.dates) {
    const onDate = preview.events.filter(e => e.date === date)

    // Purchases (and cost retired on an exit) — cash moves.
    const costLegs: Posting[] = []
    for (const e of onDate) {
      if (e.costDelta === 0) continue
      const a = accts.get(e.companyId)
      if (!a) continue
      costLegs.push({ accountId: a.costId, amount: e.costDelta, currency: 'USD', lpEntityId: null })
    }
    if (costLegs.length > 0) {
      const total = roundCents(costLegs.reduce((s, p) => s + p.amount, 0))
      costLegs.push({ accountId: cashId, amount: roundCents(-total), currency: 'USD', lpEntityId: null })
      const result = await persistEntry(admin, fundId, group, userId, {
        fundId, entryDate: date, sourceType: 'investment',
        memo: `Investment purchase — ${onDate.filter(e => e.costDelta !== 0).map(e => e.companyName).join(', ')}`,
        postings: costLegs,
      } as JournalEntry, 'posted')
      if ('error' in result) return { error: `${date}: ${result.error}` }
      entries++
    }

    // Marks — no cash, straight to unrealized.
    const markLegs: Posting[] = []
    for (const e of onDate) {
      if (e.unrealizedDelta === 0) continue
      const a = accts.get(e.companyId)
      if (!a) continue
      markLegs.push({ accountId: a.unrealizedId, amount: e.unrealizedDelta, currency: 'USD', lpEntityId: null })
    }
    if (markLegs.length > 0) {
      const total = roundCents(markLegs.reduce((s, p) => s + p.amount, 0))
      markLegs.push({ accountId: incomeId, amount: roundCents(-total), currency: 'USD', lpEntityId: null })
      const result = await persistEntry(admin, fundId, group, userId, {
        fundId, entryDate: date, sourceType: 'valuation',
        memo: `Mark to fair value — ${onDate.filter(e => e.unrealizedDelta !== 0).map(e => e.companyName).join(', ')}`,
        postings: markLegs,
      } as JournalEntry, 'posted')
      if ('error' in result) return { error: `${date}: ${result.error}` }
      entries++
    }

    // FX revaluation — the rate moved, the company didn't. Its own entry, its own
    // accounts, its own source type, so the close allocates it as a distinct line and
    // the income statement can report portfolio performance apart from currency.
    const fxLegs: Posting[] = []
    for (const e of onDate) {
      if (e.fxDelta === 0) continue
      const a = accts.get(e.companyId)
      if (!a || !fxIncomeId) continue
      fxLegs.push({ accountId: a.fxId, amount: e.fxDelta, currency: 'USD', lpEntityId: null })
    }
    if (fxLegs.length > 0 && fxIncomeId) {
      const total = roundCents(fxLegs.reduce((s, p) => s + p.amount, 0))
      fxLegs.push({ accountId: fxIncomeId, amount: roundCents(-total), currency: 'USD', lpEntityId: null })
      const result = await persistEntry(admin, fundId, group, userId, {
        fundId, entryDate: date, sourceType: 'fx_revaluation',
        memo: `Foreign currency revaluation — ${onDate.filter(e => e.fxDelta !== 0).map(e => e.companyName).join(', ')}`,
        postings: fxLegs,
      } as JournalEntry, 'posted')
      if ('error' in result) return { error: `${date}: ${result.error}` }
      entries++
    }
  }

  return {
    entries,
    dates: preview.dates.length,
    cost: preview.totalCost,
    unrealized: preview.totalUnrealized,
    fx: preview.totalFx,
  }
}

// ---------------------------------------------------------------------------
// Marking one company
// ---------------------------------------------------------------------------

/**
 * Mark ONE company to a new fair value. Books the change in unrealized against that
 * company's own account:
 *
 *   Dr/Cr 1200-<company>   delta        Cr/Dr 4200 Change in unrealized
 *
 * A write-off is just `fairValue: 0` — the position's carrying value goes to zero
 * while its cost stays on the books, which is exactly what a written-off investment
 * looks like. Cost is untouched here; realizing/retiring cost is an exit, not a mark.
 */
export async function markInvestment(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  userId: string | null,
  opts: { companyId: string; companyName: string; fairValue: number; entryDate: string; memo?: string | null }
): Promise<{ entryId: string; delta: number } | { error: string }> {
  if (!opts.entryDate) return { error: 'An entry date is required' }
  if (!Number.isFinite(opts.fairValue)) return { error: 'Fair value must be a number' }

  const accts = await ensureInvestmentAccounts(admin, fundId, group, [{ id: opts.companyId, name: opts.companyName }])
  const a = accts.get(opts.companyId)
  if (!a) return { error: `Could not resolve accounts for ${opts.companyName}` }

  const codes = await accountIdByCode(admin, fundId, group)
  const incomeId = codes.get(UNREALIZED_INCOME_CODE)
  if (!incomeId) return { error: 'Chart is missing account 4200 (Change in unrealized appreciation)' }

  const ledger = await ledgerByCompany(admin, fundId, group)
  const cur = ledger.get(opts.companyId)
  const carrying = cur?.carrying ?? 0
  const delta = roundCents(opts.fairValue - carrying)
  if (delta === 0) return { error: `${opts.companyName} already carries at ${opts.fairValue.toFixed(2)} — nothing to mark.` }

  const entry: JournalEntry = {
    fundId,
    entryDate: opts.entryDate,
    memo: opts.memo || `Mark ${opts.companyName} to ${opts.fairValue.toFixed(2)}`,
    sourceType: 'valuation',
    postings: [
      { accountId: a.unrealizedId, amount: delta, currency: 'USD', lpEntityId: null },
      { accountId: incomeId, amount: roundCents(-delta), currency: 'USD', lpEntityId: null },
    ],
  }

  const result = await persistEntry(admin, fundId, group, userId, entry, 'posted')
  if ('error' in result) return { error: result.error }
  return { entryId: result.entryId, delta }
}

// ---------------------------------------------------------------------------
// Revaluing one company for a rate move
// ---------------------------------------------------------------------------

/**
 * Book the fund-currency effect of an exchange-rate move on ONE position:
 *
 *   Dr/Cr 1250-<company>   delta        Cr/Dr 4300 Foreign currency translation
 *
 * Deliberately NOT `markInvestment`. The company did not become more valuable — the
 * currency moved — and running it through 1200/4200 would report a currency swing as
 * investment performance. Keeping them apart is what lets the income statement answer
 * "how did the portfolio do, in its own currency?" separately from "and what did the
 * dollar do to that?".
 *
 * `delta` is the fund-currency change and is the tracker's `fx_value_change`, i.e.
 * positionValueInLocalCurrency × (newRate − priorRate). Compute it with
 * `computeFxRevaluation` in lib/fx.ts rather than by hand.
 */
export async function revalueInvestmentFx(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  userId: string | null,
  opts: {
    companyId: string
    companyName: string
    /** Fund-currency gain (+) or loss (−) caused purely by the rate move. */
    delta: number
    entryDate: string
    /** For the memo — e.g. EUR 1.0850 → 1.1020. */
    currency?: string | null
    priorRate?: number | null
    newRate?: number | null
    memo?: string | null
    status?: 'draft' | 'posted'
  }
): Promise<{ entryId: string; delta: number } | { error: string }> {
  if (!opts.entryDate) return { error: 'An entry date is required' }
  const delta = roundCents(Number(opts.delta))
  if (!Number.isFinite(delta)) return { error: 'The FX value change must be a number' }
  if (delta === 0) return { error: 'The rate did not move — nothing to revalue.' }

  const accts = await ensureInvestmentAccounts(admin, fundId, group, [{ id: opts.companyId, name: opts.companyName }])
  const a = accts.get(opts.companyId)
  if (!a) return { error: `Could not resolve accounts for ${opts.companyName}` }

  const codes = await accountIdByCode(admin, fundId, group)
  const fxIncomeId = codes.get(FX_INCOME_CODE)
  if (!fxIncomeId) {
    return { error: 'Chart is missing account 4300 (Foreign currency translation) — re-sync the chart of accounts' }
  }

  const rates = opts.priorRate != null && opts.newRate != null
    ? ` (${opts.currency ?? 'FX'} ${opts.priorRate} → ${opts.newRate})`
    : ''

  const entry: JournalEntry = {
    fundId,
    entryDate: opts.entryDate,
    memo: opts.memo || `Foreign currency revaluation — ${opts.companyName}${rates}`,
    sourceType: 'fx_revaluation',
    postings: [
      { accountId: a.fxId, amount: delta, currency: 'USD', lpEntityId: null },
      { accountId: fxIncomeId, amount: roundCents(-delta), currency: 'USD', lpEntityId: null },
    ],
  }

  const result = await persistEntry(admin, fundId, group, userId, entry, opts.status ?? 'posted')
  if ('error' in result) return { error: result.error }
  return { entryId: result.entryId, delta }
}
