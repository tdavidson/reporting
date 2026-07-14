// Capital-call register + reporting. A call recognizes contributed capital and a
// receivable (chart 1300 "Due from LPs") when issued; funding clears it later.
// Called/funded/outstanding all derive from the capital postings + the call register,
// so they never drift:
//   called      = Σ capital_call_lines.amount for the LP (the register)
//   receivable  = the LP's balance in account 1300 (from the posted ledger)
//   funded      = called − receivable   (cash actually received)
//   outstanding = commitment − called   (commitment REMAINING TO BE CALLED)
//
// `outstanding` used to be `commitment − funded`, which is uncalled capital PLUS the
// receivable — so it overlapped with `receivable` and the two double-counted anywhere both
// were shown (the capital-accounts table and the LP statement PDF both show both). It also
// disagreed with `live-report.ts`, where `outstanding_balance = commitment − paidIn`, and
// with the LP snapshot's `outstanding_balance` ("remaining uncalled commitment") — so the
// same LP could read a different number on their statement than on their snapshot.
//
// The four are now disjoint and read left to right as the life of a commitment:
//   committed → called → funded, with `outstanding` still to be called and `receivable`
//   called but not yet in the bank. Total cash the LP still owes = outstanding + receivable.
//
// The reporting functions here go through `loadCapitalPostings`, NOT `loadPostedLedger`,
// so they serve a capital-tracking-only vehicle (capital_source='events') as well as a
// booked one. On an events vehicle the receivable is always empty — recognize-at-call is
// a double-entry construct, and an event is recorded when the money moves — so called
// and funded are the same thing there. That is the model, not a gap.

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPostedLedger, loadOwnership, loadEntityNames, loadEntityClasses } from './load'
import { loadCapitalPostings } from './capital-source'
import { accountIdByCode, ensureCapitalAccounts, persistEntry } from './persist'
import { computeCapitalAccounts, emptyAccount, type CapitalAccount, type CapitalPeriod } from './capital-account'
import { buildCapitalCallIssuanceEntry } from './entries'
import { allocateAmount } from './allocation'
import { vehicleIdByName } from './vehicle-id'
import { roundCents } from './ledger'
import { RECEIVABLE_CODE } from './chart'

// Re-exported for the callers that have always imported it from here.
export { RECEIVABLE_CODE }

export interface CallLineInput {
  lpEntityId: string
  amount: number
}

/** Split a fund-wide call total across LPs pro-rata by commitment (to the cent). */
export async function proRataCall(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  total: number
): Promise<CallLineInput[]> {
  const owners = await loadOwnership(admin, fundId, group)
  const funded = owners.filter(o => o.commitment > 0)
  if (funded.length === 0) return []
  const split = allocateAmount(total, funded.map(o => ({ lpEntityId: o.lpEntityId, commitment: o.commitment })))
  return Array.from(split.entries()).map(([lpEntityId, amount]) => ({ lpEntityId, amount }))
}

export interface IssueCallInput {
  callDate: string
  description?: string | null
  scope: 'fund_wide' | 'per_lp'
  lines: CallLineInput[]
}

/**
 * Issue a capital call: post the receivable/capital entry (Dr 1300 / Cr each LP's
 * capital) and record the call + its per-LP lines in the register.
 */
export async function issueCapitalCall(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  userId: string | null,
  input: IssueCallInput
): Promise<{ callId: string; entryId: string } | { error: string }> {
  const lines = (input.lines ?? []).filter(l => l.lpEntityId && Number(l.amount) > 0)
  if (lines.length === 0) return { error: 'A call needs at least one LP with a positive amount' }
  if (!input.callDate) return { error: 'A call date is required' }

  const codes = await accountIdByCode(admin, fundId, group)
  const receivableId = codes.get(RECEIVABLE_CODE)
  if (!receivableId) return { error: `Seed the chart of accounts first (missing ${RECEIVABLE_CODE} Due from LPs)` }

  const capMap = await ensureCapitalAccounts(admin, fundId, group, lines.map(l => l.lpEntityId))
  const perLp = new Map<string, number>()
  for (const l of lines) perLp.set(l.lpEntityId, roundCents((perLp.get(l.lpEntityId) ?? 0) + Number(l.amount)))

  const entry = buildCapitalCallIssuanceEntry(
    { fundId, entryDate: input.callDate, memo: input.description || 'Capital call' },
    perLp,
    capMap,
    receivableId
  )
  const result = await persistEntry(admin, fundId, group, userId, entry, 'posted')
  if ('error' in result) return { error: result.error }

  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const { data: call, error: callErr } = await admin
    .from('capital_calls' as any)
    .insert({
      fund_id: fundId,
      vehicle_id: vehicleId,
      call_date: input.callDate,
      description: input.description ?? null,
      scope: input.scope,
      status: 'issued',
      journal_entry_id: result.entryId,
      created_by: userId,
    })
    .select('id')
    .single()
  if (callErr) return { error: callErr.message }
  const callId = (call as any).id

  const { error: lineErr } = await admin.from('capital_call_lines' as any).insert(
    Array.from(perLp.entries()).map(([lpEntityId, amount]) => ({
      call_id: callId,
      fund_id: fundId,
      vehicle_id: vehicleId,
      lp_entity_id: lpEntityId,
      amount,
    }))
  )
  if (lineErr) return { error: lineErr.message }

  return { callId, entryId: result.entryId }
}

/** The receivable (1300) balance per LP from the posted ledger. */
export async function lpReceivableBalances(
  admin: SupabaseClient,
  fundId: string,
  group: string
): Promise<Map<string, number>> {
  const { accounts, postings } = await loadPostedLedger(admin, fundId, group)
  const receivable = accounts.find(a => a.code === RECEIVABLE_CODE)
  const out = new Map<string, number>()
  if (!receivable) return out
  for (const p of postings) {
    if (p.accountId !== receivable.id || !p.lpEntityId) continue
    out.set(p.lpEntityId, roundCents((out.get(p.lpEntityId) ?? 0) + p.amount))
  }
  return out
}

/** Sum of called amounts per LP, from the call register. */
export async function lpCalledTotals(
  admin: SupabaseClient,
  fundId: string,
  group: string
): Promise<Map<string, number>> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const { data } = await admin
    .from('capital_call_lines' as any)
    .select('lp_entity_id, amount')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
  const out = new Map<string, number>()
  for (const r of ((data as any[]) ?? [])) {
    out.set(r.lp_entity_id, roundCents((out.get(r.lp_entity_id) ?? 0) + Number(r.amount)))
  }
  return out
}

export interface CapitalCallRow {
  id: string
  callDate: string
  description: string | null
  scope: string
  total: number
  lines: { lpEntityId: string; name: string; amount: number }[]
}

/** Issued calls (most recent first) with their per-LP lines. */
export async function listCapitalCalls(
  admin: SupabaseClient,
  fundId: string,
  group: string
): Promise<CapitalCallRow[]> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const [{ data: calls }, names] = await Promise.all([
    admin
      .from('capital_calls' as any)
      .select('id, call_date, description, scope, capital_call_lines(lp_entity_id, amount)')
      .eq('fund_id', fundId)
      .eq('vehicle_id', vehicleId)
      .order('call_date', { ascending: false }),
    loadEntityNames(admin, fundId, group),
  ])
  return ((calls as any[]) ?? []).map(c => {
    const lines = ((c.capital_call_lines as any[]) ?? []).map(l => ({
      lpEntityId: l.lp_entity_id,
      name: names.get(l.lp_entity_id) ?? l.lp_entity_id,
      amount: Number(l.amount),
    }))
    return {
      id: c.id,
      callDate: c.call_date,
      description: c.description ?? null,
      scope: c.scope,
      total: roundCents(lines.reduce((s, l) => s + l.amount, 0)),
      lines,
    }
  })
}

export interface LpCapitalRow {
  lpEntityId: string
  name: string
  partnerClass: string
  /** What the LP signed up for. */
  commitment: number
  /** What has been asked for so far. Capital is recognized here, not at funding. */
  called: number
  /** What actually arrived: called − receivable. */
  funded: number
  /** Remaining to be CALLED: commitment − called. Disjoint from `receivable`. */
  outstanding: number
  /** Called but not yet in the bank (acct 1300). Always 0 on an events vehicle. */
  receivable: number
  /** Capital-account ending balance (the LP's NAV). */
  ending: number
}

/** Per-LP commitment / called / funded / outstanding + ending capital (NAV). */
export async function lpCapitalSummary(
  admin: SupabaseClient,
  fundId: string,
  group: string
): Promise<LpCapitalRow[]> {
  // One source-aware load: `postings` come from the ledger or from lp_capital_events
  // depending on the vehicle, and `receivableByLp` falls out of the same read (it is
  // always empty for an events vehicle).
  const [{ postings: capitalPostings, receivableByLp }, owners, names, classes] = await Promise.all([
    loadCapitalPostings(admin, fundId, group),
    loadOwnership(admin, fundId, group),
    loadEntityNames(admin, fundId, group),
    loadEntityClasses(admin, fundId, group),
  ])
  const commitmentByLp = new Map(owners.map(o => [o.lpEntityId, o.commitment]))
  const accountByLp = computeCapitalAccounts(capitalPostings)

  const ids = new Set<string>([
    ...Array.from(names.keys()),
    ...Array.from(commitmentByLp.keys()),
    ...Array.from(accountByLp.keys()),
  ])

  const rows: LpCapitalRow[] = Array.from(ids).map(lpEntityId => {
    const acct = accountByLp.get(lpEntityId)
    return {
      lpEntityId,
      name: names.get(lpEntityId) ?? lpEntityId,
      partnerClass: classes.get(lpEntityId) ?? 'lp',
      ...commitmentFigures(
        commitmentByLp.get(lpEntityId) ?? 0,
        // Called = capital recognized via call entries (the contributions bucket).
        acct?.contributions ?? 0,
        receivableByLp.get(lpEntityId) ?? 0,
      ),
      ending: roundCents(acct?.ending ?? 0),
    }
  })
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The commitment-side arithmetic, pulled out so it can be pinned by a test.
 *
 * It is four numbers and it silently changed meaning once already, so it gets to be a
 * function rather than four expressions buried in a `.map`.
 *
 * The invariant that matters: `outstanding` and `receivable` are DISJOINT. One is capital
 * not yet asked for, the other is capital asked for and not yet received. Total cash the
 * LP still owes is the sum of them — which is what `outstanding` used to be on its own,
 * which is why it double-counted against `receivable` wherever both were displayed.
 */
export function commitmentFigures(
  commitmentRaw: number,
  calledRaw: number,
  receivableRaw: number,
): { commitment: number; called: number; funded: number; outstanding: number; receivable: number } {
  const commitment = roundCents(commitmentRaw)
  const called = roundCents(calledRaw)
  const receivable = roundCents(receivableRaw)
  return {
    commitment,
    called,
    funded: roundCents(called - receivable),      // cash actually received
    outstanding: roundCents(commitment - called), // remaining to be called
    receivable,
  }
}

export interface LpStatementTxn {
  date: string
  memo: string | null
  sourceType: string | null
  amount: number   // signed change to the LP's capital (credit +, debit −)
  balance: number  // running capital balance
}
export interface LpStatement {
  row: LpCapitalRow
  /** Inception-to-date roll-forward. */
  rollForward: CapitalAccount
  /** Roll-forward scoped to the statement period, opening with capital carried in. */
  periodRollForward: CapitalAccount
  transactions: LpStatementTxn[]
}

/** One movement in an LP's capital, before it is windowed into a statement.
 *  `delta` is credit-positive: what the movement did to the LP's capital. */
interface Movement { date: string; memo: string | null; sourceType: string | null; delta: number }

/** Movements from the posted ledger — the LP's own capital sub-account in the chart. */
async function ledgerMovements(
  admin: SupabaseClient,
  fundId: string,
  vehicleId: string | null,
  lpEntityId: string
): Promise<Movement[]> {
  const { data: acct } = await admin
    .from('chart_of_accounts' as any)
    .select('id')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .eq('lp_entity_id', lpEntityId)
    .maybeSingle()
  if (!acct) return []

  const { data: rows } = await admin
    .from('journal_postings' as any)
    .select('amount, journal_entries!inner(entry_date, memo, source_type, status)')
    .eq('fund_id', fundId)
    .eq('account_id', (acct as any).id)

  return ((rows as any[]) ?? [])
    .filter(r => r.journal_entries?.status === 'posted')
    .map(r => ({
      date: String(r.journal_entries.entry_date ?? ''),
      memo: r.journal_entries.memo ?? null,
      sourceType: r.journal_entries.source_type ?? null,
      delta: roundCents(-Number(r.amount)),
    }))
}

/** Movements from lp_capital_events — a vehicle tracked at the capital-account level only. */
async function eventMovements(
  admin: SupabaseClient,
  fundId: string,
  vehicleId: string | null,
  lpEntityId: string
): Promise<Movement[]> {
  if (!vehicleId) return []
  const { data } = await admin
    .from('lp_capital_events' as any)
    .select('event_date, memo, source_type, amount')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .eq('lp_entity_id', lpEntityId)

  return ((data as any[]) ?? []).map(r => ({
    date: String(r.event_date ?? ''),
    memo: (r.memo as string) ?? null,
    sourceType: (r.source_type as string) ?? null,
    delta: roundCents(-Number(r.amount ?? 0)),
  }))
}

/** A single LP's capital statement: summary, roll-forward, and every capital movement. */
export async function lpStatement(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  lpEntityId: string,
  period?: CapitalPeriod
): Promise<LpStatement | { error: string }> {
  const summary = await lpCapitalSummary(admin, fundId, group)
  const row = summary.find(r => r.lpEntityId === lpEntityId)
  if (!row) return { error: 'LP not found in this vehicle' }

  const { source, postings: capitalPostings } = await loadCapitalPostings(admin, fundId, group)
  const rollForward = computeCapitalAccounts(capitalPostings, { end: period?.end })
    .get(lpEntityId) ?? emptyAccount()
  const periodRollForward = computeCapitalAccounts(capitalPostings, period)
    .get(lpEntityId) ?? emptyAccount()

  const vehicleId = await vehicleIdByName(admin, fundId, group)

  // The movements behind the roll-forward, from whichever producer this vehicle uses. Both
  // store debit-positive (like journal_postings), so a capital delta is the negated amount
  // either way.
  const movements = source === 'ledger'
    ? await ledgerMovements(admin, fundId, vehicleId, lpEntityId)
    : await eventMovements(admin, fundId, vehicleId, lpEntityId)
  movements.sort((a, b) => a.date.localeCompare(b.date))

  // The statement lists activity IN THE PERIOD, under exactly that heading. This used to
  // return every posting since inception with no date filter at all, so a Q3 statement listed
  // the LP's entire history labelled as one quarter's activity.
  //
  // The running balance still accumulates from INCEPTION — a period statement's closing
  // balance is the LP's real capital, not the sum of three months. So we walk everything, and
  // only emit the rows that fall inside the window.
  const transactions: LpStatementTxn[] = []
  let balance = 0
  for (const m of movements) {
    // Anything after the statement date isn't on this statement — it hasn't happened yet as
    // far as this document is concerned, and must not move the closing balance either.
    if (period?.end && m.date > period.end) continue

    balance = roundCents(balance + m.delta)

    if (period?.start && m.date < period.start) continue // carried into `beginning`, not listed
    transactions.push({ date: m.date, memo: m.memo, sourceType: m.sourceType, amount: m.delta, balance })
  }

  return { row, rollForward, periodRollForward, transactions }
}
