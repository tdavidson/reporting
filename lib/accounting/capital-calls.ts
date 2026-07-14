// Capital-call register + reporting. A call recognizes contributed capital and a
// receivable (chart 1300 "Due from LPs") when issued; funding clears it later.
// Called/funded/outstanding all derive from the ledger + the call register, so
// they never drift:
//   called      = Σ capital_call_lines.amount for the LP (the register)
//   receivable  = the LP's balance in account 1300 (from the posted ledger)
//   funded      = called − receivable   (cash actually received)
//   outstanding = commitment − funded   (commitment still to be paid in)

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPostedLedger, loadOwnership, loadEntityNames, loadEntityClasses } from './load'
import { accountIdByCode, ensureCapitalAccounts, persistEntry } from './persist'
import { computeCapitalAccounts, emptyAccount, type CapitalAccount, type CapitalPeriod } from './capital-account'
import { buildCapitalCallIssuanceEntry } from './entries'
import { allocateAmount } from './allocation'
import { vehicleIdByName } from './vehicle-id'
import { roundCents } from './ledger'

/** The chart account that holds called-but-unfunded capital (a receivable). */
export const RECEIVABLE_CODE = '1300'

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
  commitment: number
  called: number
  funded: number
  outstanding: number
  receivable: number
  ending: number
}

/** Per-LP commitment / called / funded / outstanding + ending capital (NAV). */
export async function lpCapitalSummary(
  admin: SupabaseClient,
  fundId: string,
  group: string
): Promise<LpCapitalRow[]> {
  const [{ capitalPostings }, owners, names, classes, receivableByLp] = await Promise.all([
    loadPostedLedger(admin, fundId, group),
    loadOwnership(admin, fundId, group),
    loadEntityNames(admin, fundId, group),
    loadEntityClasses(admin, fundId, group),
    lpReceivableBalances(admin, fundId, group),
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
    const commitment = roundCents(commitmentByLp.get(lpEntityId) ?? 0)
    // Called = capital recognized via call entries (the contributions bucket).
    const called = roundCents(acct?.contributions ?? 0)
    const receivable = roundCents(receivableByLp.get(lpEntityId) ?? 0)
    const funded = roundCents(called - receivable) // cash actually received
    return {
      lpEntityId,
      name: names.get(lpEntityId) ?? lpEntityId,
      partnerClass: classes.get(lpEntityId) ?? 'lp',
      commitment,
      called,
      funded,
      outstanding: roundCents(commitment - funded),
      receivable,
      ending: roundCents(acct?.ending ?? 0),
    }
  })
  return rows.sort((a, b) => a.name.localeCompare(b.name))
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

  const { capitalPostings } = await loadPostedLedger(admin, fundId, group)
  const rollForward = computeCapitalAccounts(capitalPostings, { end: period?.end })
    .get(lpEntityId) ?? emptyAccount()
  const periodRollForward = computeCapitalAccounts(capitalPostings, period)
    .get(lpEntityId) ?? emptyAccount()

  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const { data: acct } = await admin
    .from('chart_of_accounts' as any)
    .select('id')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .eq('lp_entity_id', lpEntityId)
    .maybeSingle()

  // The statement lists activity IN THE PERIOD, under exactly that heading. This used to
  // return every posting since inception with no date filter at all, so a Q3 statement listed
  // the LP's entire history labelled as one quarter's activity.
  //
  // The running balance still accumulates from INCEPTION — a period statement's closing
  // balance is the LP's real capital, not the sum of three months. So we walk everything, and
  // only emit the rows that fall inside the window.
  const transactions: LpStatementTxn[] = []
  if (acct) {
    const { data: rows } = await admin
      .from('journal_postings' as any)
      .select('amount, journal_entries!inner(entry_date, memo, source_type, status)')
      .eq('fund_id', fundId)
      .eq('account_id', (acct as any).id)
    const posted = ((rows as any[]) ?? [])
      .filter(r => r.journal_entries?.status === 'posted')
      .map(r => ({ e: r.journal_entries, delta: roundCents(-Number(r.amount)) }))
      .sort((a, b) => String(a.e.entry_date).localeCompare(String(b.e.entry_date)))

    let balance = 0
    for (const p of posted) {
      const date = String(p.e.entry_date ?? '')
      // Anything after the statement date isn't on this statement — it hasn't happened yet as
      // far as this document is concerned, and must not move the closing balance either.
      if (period?.end && date > period.end) continue

      balance = roundCents(balance + p.delta)

      if (period?.start && date < period.start) continue // carried into `beginning`, not listed
      transactions.push({ date: p.e.entry_date, memo: p.e.memo ?? null, sourceType: p.e.source_type ?? null, amount: p.delta, balance })
    }
  }

  return { row, rollForward, periodRollForward, transactions }
}
