// Period close — the ONE place where P&L is allocated to partners' capital.
//
// Expense/income/valuation entries are booked simply (Dr expense / Cr cash). They
// never touch a capital account. Closing a period allocates that period's P&L to
// each partner and locks the books.
//
// WHY ONE ENTRY PER CATEGORY, not one for net income:
// a capital account's roll-forward lines are driven by the journal entry's
// source_type, and source_type is per-ENTRY, not per-posting. A single
// "net income" allocation would land entirely in one bucket and the statement of
// changes in partners' capital would lose the distinction between management fees,
// expenses, operating income, and marks. So the close posts one balanced entry per
// category, each tagged with the source_type that maps to its roll-forward line.
//
// THE BRIDGE. Each allocation is offset to 3200 Undistributed earnings, so the
// P&L accounts stay open (a YTD income statement still reports) while capital
// accounts pick up their share. The bridge exactly cancels the double-count, so the
// balance sheet keeps balancing:
//   equity = capital accounts + bridge + open P&L = net assets, always.
//
// REOPENING. Every entry a close posts carries source_ref = `close:<periodId>`.
// Reopening voids exactly those entries — nothing else — so a mistake is reversible
// without hand-unwinding fifteen capital postings.

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPostedLedger, loadOwnership, loadEntityNames } from './load'
import { accountIdByCode, ensureCapitalAccounts, persistEntry } from './persist'
import { allocateAmount } from './allocation'
import { postingsInPeriod } from './statements'
import { computeCapitalAccounts } from './capital-account'
import { closedPeriodRanges } from './periods'
import {
  loadAllocationBasis, loadPartnerTerms, loadCommitmentEvents,
  commitmentsAsOf, allocationWeights,
  type AllocationBasis, type AllocationCategory,
} from './terms'
import { exportLedgerText } from './text-ledger-run'
import { vehicleIdByName } from './vehicle-id'
import { roundCents } from './ledger'
import type { Account, JournalEntry, Posting } from './types'

/** The undistributed-earnings bridge. */
const BRIDGE_CODE = '3200'

/**
 * Which roll-forward line a P&L account allocates to, keyed by the account's
 * subtype. The value is the journal source_type, which `bucketForSourceType` maps
 * to a capital-account line. Anything unrecognized falls back by account type, so
 * a new account can never silently drop out of the allocation.
 */
const SUBTYPE_TO_SOURCE: Record<string, string> = {
  management_fee: 'management_fee',
  partnership_expense: 'partnership_expense',
  organizational_expense: 'organizational_expense',
  interest_expense: 'partnership_expense', // an expense of the partnership; same line
  operating_expense: 'partnership_expense',
  realized_gain: 'realized_gain',
  unrealized: 'valuation',
  interest_income: 'income',
  equity_method: 'income',
}

function sourceTypeFor(account: Account): string {
  const mapped = account.subtype ? SUBTYPE_TO_SOURCE[account.subtype] : undefined
  if (mapped) return mapped
  return account.type === 'expense' ? 'partnership_expense' : 'income'
}

export interface CloseCategory {
  sourceType: string
  label: string
  /** Net effect on partners' capital: positive increases capital. */
  capitalEffect: number
  accounts: { code: string; name: string; amount: number }[]
  lines: { lpEntityId: string; name: string; amount: number }[]
}

export interface ClosePreview {
  periodStart: string
  periodEnd: string
  /** Net income for the period — the sum of every category's capital effect. */
  netIncome: number
  categories: CloseCategory[]
  /** Basis used to split each category across partners. */
  basis: AllocationBasis
  warnings: string[]
}

const CATEGORY_LABELS: Record<string, string> = {
  management_fee: 'Management fees',
  partnership_expense: 'Partnership expenses',
  organizational_expense: 'Organizational expenses',
  realized_gain: 'Net realized gain / (loss)',
  valuation: 'Net unrealized gain / (loss)',
  income: 'Operating income',
}

/**
 * What closing this period would allocate, without writing anything. This is the
 * preview the user approves — and the same computation the close itself runs.
 */
export async function previewClose(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  periodStart: string,
  periodEnd: string
): Promise<ClosePreview | { error: string }> {
  if (!periodStart || !periodEnd || periodStart > periodEnd) {
    return { error: 'A valid period start and end are required' }
  }
  const existing = await closedPeriodRanges(admin, fundId, group)
  if (existing.some(p => periodStart <= p.period_end && periodEnd >= p.period_start)) {
    return { error: 'This period overlaps an already-closed period — reopen it first' }
  }

  const [{ accounts, postings, capitalPostings }, owners, names, basis, terms, commitmentEvents] = await Promise.all([
    loadPostedLedger(admin, fundId, group),
    loadOwnership(admin, fundId, group),
    loadEntityNames(admin, fundId, group),
    loadAllocationBasis(admin, fundId, group),
    loadPartnerTerms(admin, fundId, group),
    loadCommitmentEvents(admin, fundId, group),
  ])

  const warnings: string[] = []

  // The basis amount per partner, as of the PERIOD END — not today. Closing an old
  // period must use the commitments (or balances) that were in force then.
  let basisAmounts: { lpEntityId: string; basisAmount: number }[]
  if (basis === 'capital_balance') {
    const balances = computeCapitalAccounts(capitalPostings, { end: periodEnd })
    basisAmounts = Array.from(balances.entries()).map(([lpEntityId, a]) => ({ lpEntityId, basisAmount: a.ending }))
  } else if (commitmentEvents.length > 0) {
    basisAmounts = Array.from(commitmentsAsOf(commitmentEvents, periodEnd).entries())
      .map(([lpEntityId, commitment]) => ({ lpEntityId, basisAmount: commitment }))
  } else {
    // No event history yet (migration not pushed): fall back to the scalar commitment.
    warnings.push('No commitment history found — falling back to each partner’s current commitment. Push the commitment-events migration to allocate historical periods correctly.')
    basisAmounts = owners.map(o => ({ lpEntityId: o.lpEntityId, basisAmount: o.commitment }))
  }

  const eligible = basisAmounts.filter(b => b.basisAmount > 0)
  if (eligible.length === 0) {
    return { error: basis === 'capital_balance'
      ? 'No partner has a positive capital balance at the period end — nothing to allocate on'
      : 'No partners with a commitment — nothing to allocate to' }
  }

  const inPeriod = postingsInPeriod(postings, periodStart, periodEnd)
  const pnlAccounts = accounts.filter(a => a.type === 'income' || a.type === 'expense')
  const pnlById = new Map(pnlAccounts.map(a => [a.id, a]))

  // Group the period's P&L by category. `amount` is the debit-side sum, so an
  // expense is positive and income is negative.
  const byCategory = new Map<string, Map<string, number>>()
  for (const p of inPeriod) {
    const acct = pnlById.get(p.accountId)
    if (!acct) continue
    const cat = sourceTypeFor(acct)
    const perAccount = byCategory.get(cat) ?? new Map<string, number>()
    perAccount.set(acct.id, roundCents((perAccount.get(acct.id) ?? 0) + p.amount))
    byCategory.set(cat, perAccount)
  }

  const categories: CloseCategory[] = []
  for (const [sourceType, perAccount] of Array.from(byCategory.entries())) {
    const debitSide = roundCents(Array.from(perAccount.values()).reduce((s, v) => s + v, 0))
    // Capital rises when income exceeds expense; debit-side is the opposite sign.
    const capitalEffect = roundCents(-debitSide)
    if (capitalEffect === 0) continue

    // Terms are per CATEGORY: a partner excluded from management fee still bears its
    // share of expenses and still receives its share of gains.
    const weights = allocationWeights(eligible, terms, sourceType as AllocationCategory)
    if (weights.length === 0) {
      warnings.push(`No partner participates in ${CATEGORY_LABELS[sourceType] ?? sourceType} — it cannot be allocated and will be skipped.`)
      continue
    }
    const excluded = eligible.length - weights.length
    if (excluded > 0) {
      warnings.push(`${excluded} partner(s) excluded from ${CATEGORY_LABELS[sourceType] ?? sourceType}; their share is redistributed across the rest.`)
    }

    const split = allocateAmount(capitalEffect, weights)
    categories.push({
      sourceType,
      label: CATEGORY_LABELS[sourceType] ?? sourceType,
      capitalEffect,
      accounts: Array.from(perAccount.entries())
        .map(([id, amount]) => {
          const a = pnlById.get(id)!
          return { code: a.code, name: a.name, amount: roundCents(amount) }
        })
        .filter(a => a.amount !== 0),
      lines: Array.from(split.entries()).map(([lpEntityId, amount]) => ({
        lpEntityId,
        name: names.get(lpEntityId) ?? lpEntityId,
        amount: roundCents(amount),
      })),
    })
  }

  const netIncome = roundCents(categories.reduce((s, c) => s + c.capitalEffect, 0))
  if (categories.length === 0) warnings.push('No P&L activity in this period — closing will lock the books without allocating anything.')

  // Closing out of order strands P&L: any income or expense dated BEFORE this period
  // that isn't inside a closed period will never be allocated to anyone, because the
  // close only ever allocates what's inside its own window.
  const priorUnclosed = postings.filter(p => {
    if (!pnlById.has(p.accountId)) return false
    const d = p.entryDate
    if (!d || d >= periodStart) return false
    return !existing.some(cp => d >= cp.period_start && d <= cp.period_end)
  })
  if (priorUnclosed.length > 0) {
    const earliest = priorUnclosed.map(p => p.entryDate!).sort()[0]
    const amount = roundCents(-priorUnclosed.reduce((s, p) => s + p.amount, 0))
    warnings.push(
      `There is unallocated P&L before this period (from ${earliest}, net ${amount.toFixed(2)}) that no closed period covers. ` +
      `Close the earlier period first, or extend this one back — otherwise that income and expense is never allocated to any partner.`
    )
  }

  return { periodStart, periodEnd, netIncome, categories, basis, warnings }
}

// ---------------------------------------------------------------------------
// Closing THROUGH a date — the model you actually want
// ---------------------------------------------------------------------------
//
// Picking an arbitrary start and end lets you strand P&L in an uncovered gap. So the
// close takes only an END date: the start is DERIVED (the day after the last closed
// period, or inception), which makes gaps impossible by construction.
//
// The span is then split into CALENDAR MONTHS and each is closed as its own period.
// Closing a quarter therefore closes its three months. That isn't cosmetic: the
// allocation basis is measured at each period end, so if a partner's commitment
// changes in February, allocating Jan–Mar as one lump at March's weights would
// misallocate January. Month-by-month gets each month's ownership right, and lets you
// reopen a single month instead of a whole quarter.

/** Split [start, end] into calendar-month windows. The first and last may be partial. */
export function monthWindows(start: string, end: string): { start: string; end: string; label: string }[] {
  if (start > end) return []
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const out: { start: string; end: string; label: string }[] = []

  let cursor = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)

  while (cursor <= last) {
    const y = cursor.getUTCFullYear()
    const m = cursor.getUTCMonth()
    const monthEnd = new Date(Date.UTC(y, m + 1, 0))
    const winEnd = monthEnd > last ? last : monthEnd
    out.push({
      start: iso(cursor),
      end: iso(winEnd),
      label: new Date(Date.UTC(y, m, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    })
    cursor = new Date(Date.UTC(y, m + 1, 1))
  }
  return out
}

/**
 * Where the next close starts: the day after the last closed period, or the earliest
 * posted entry if nothing has been closed yet. Null when there's nothing to close.
 */
export async function nextCloseStart(
  admin: SupabaseClient,
  fundId: string,
  group: string
): Promise<string | null> {
  const closed = await closedPeriodRanges(admin, fundId, group)
  if (closed.length > 0) {
    const latest = closed.map(p => p.period_end).sort().pop()!
    const next = new Date(`${latest}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    return next.toISOString().slice(0, 10)
  }

  const { postings } = await loadPostedLedger(admin, fundId, group)
  const dates = postings.map(p => p.entryDate).filter(Boolean).sort() as string[]
  return dates.length > 0 ? dates[0] : null
}

/**
 * Is the ledger ready to be closed for this span?
 *
 * The close allocates POSTED entries only. Anything still sitting as a draft inside
 * the window — an uncategorized bank transaction, an entry someone never posted —
 * has no P&L in the ledger yet, so it is allocated to nobody. Once the period locks,
 * it can't even be posted into that month without reopening. That silent stranding is
 * a blocker, not a warning.
 *
 * A bank balance that doesn't tie is a warning: it may be a timing difference you
 * knowingly accept, and it doesn't corrupt the allocation.
 */
export interface CloseReadiness {
  draftEntries: { count: number; earliest: string | null }
  unpostedBankTxns: { count: number; total: number }
  bank: { tiesOut: boolean; difference: number } | null
  blockers: string[]
  warnings: string[]
}

export interface CloseThroughPreview {
  start: string
  end: string
  /** One preview per calendar month in the span. */
  months: ClosePreview[]
  totalNetIncome: number
  basis: AllocationBasis
  readiness: CloseReadiness
  warnings: string[]
}

/** Pre-close checks over the whole span. */
async function checkReadiness(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  start: string,
  end: string
): Promise<CloseReadiness> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)

  const [{ data: drafts }, { data: bankTxns }] = await Promise.all([
    admin.from('journal_entries' as any)
      .select('id, entry_date')
      .eq('fund_id', fundId).eq('vehicle_id', vehicleId)
      .eq('status', 'draft')
      .gte('entry_date', start).lte('entry_date', end),
    admin.from('bank_transactions' as any)
      .select('id, amount, status')
      .eq('fund_id', fundId).eq('vehicle_id', vehicleId)
      .gte('txn_date', start).lte('txn_date', end)
      .in('status', ['unmatched', 'drafted']),
  ])

  const draftRows = ((drafts as any[]) ?? [])
  const bankRows = ((bankTxns as any[]) ?? [])

  const blockers: string[] = []
  const warnings: string[] = []

  if (draftRows.length > 0) {
    const earliest = draftRows.map(d => d.entry_date).sort()[0]
    blockers.push(
      `${draftRows.length} journal entr${draftRows.length === 1 ? 'y is' : 'ies are'} still in draft inside this span (from ${earliest}). ` +
      `A draft has no P&L in the ledger, so closing would allocate nothing for it — and lock the period so it can't be posted. Post or void them first.`
    )
  }

  if (bankRows.length > 0) {
    const total = roundCents(bankRows.reduce((s, t) => s + Number(t.amount), 0))
    blockers.push(
      `${bankRows.length} bank transaction${bankRows.length === 1 ? '' : 's'} in this span ${bankRows.length === 1 ? 'is' : 'are'} not posted yet (net ${total.toFixed(2)}). ` +
      `Categorize and post them on the Bank page — otherwise their income and expense is never allocated to any partner.`
    )
  }

  return {
    draftEntries: { count: draftRows.length, earliest: draftRows.map(d => d.entry_date).sort()[0] ?? null },
    unpostedBankTxns: {
      count: bankRows.length,
      total: roundCents(bankRows.reduce((s, t) => s + Number(t.amount), 0)),
    },
    bank: null,
    blockers,
    warnings,
  }
}

/** What closing through `endDate` would allocate, month by month. Writes nothing. */
export async function previewCloseThrough(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  endDate: string
): Promise<CloseThroughPreview | { error: string }> {
  if (!endDate) return { error: 'An end date is required' }

  const start = await nextCloseStart(admin, fundId, group)
  if (!start) return { error: 'Nothing to close — the ledger has no posted entries' }
  if (start > endDate) return { error: `Already closed through ${start} — pick a later date` }

  const windows = monthWindows(start, endDate)
  const months: ClosePreview[] = []
  const warnings: string[] = []

  for (const w of windows) {
    const p = await previewClose(admin, fundId, group, w.start, w.end)
    if ('error' in p) return { error: `${w.label}: ${p.error}` }
    // The gap warning can't fire here — the start is derived, so there is no gap.
    months.push({ ...p, warnings: p.warnings.filter(x => !x.startsWith('There is unallocated P&L before')) })
  }

  const withActivity = months.filter(m => m.categories.length > 0)
  if (withActivity.length === 0) {
    warnings.push('No P&L activity in this span — closing will lock the books without allocating anything.')
  }
  const basis = months[0]?.basis ?? 'commitment'
  const readiness = await checkReadiness(admin, fundId, group, start, endDate)

  return {
    start,
    end: endDate,
    months,
    totalNetIncome: roundCents(months.reduce((s, m) => s + m.netIncome, 0)),
    basis,
    readiness,
    warnings,
  }
}

/**
 * Close every month from the derived start through `endDate`, in order. Each month is
 * its own fiscal period with its own allocation entries, so a single month can be
 * reopened later without unwinding the rest.
 *
 * Stops at the first failure and leaves earlier months closed — they're valid on their
 * own, and re-running picks up where it left off (the start is derived).
 */
export async function closeThrough(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  userId: string | null,
  endDate: string
): Promise<{ closed: { id: string; label: string; netIncome: number }[] } | { error: string }> {
  const preview = await previewCloseThrough(admin, fundId, group, endDate)
  if ('error' in preview) return preview

  // Refuse rather than strand P&L. The preview shows these too, but the check is
  // enforced HERE so it can't be bypassed by calling the API directly.
  if (preview.readiness.blockers.length > 0) {
    return { error: `Not ready to close. ${preview.readiness.blockers.join(' ')}` }
  }

  const windows = monthWindows(preview.start, preview.end)
  const closed: { id: string; label: string; netIncome: number }[] = []

  for (const w of windows) {
    const result = await closePeriodWithAllocation(admin, fundId, group, userId, w.start, w.end, w.label)
    if ('error' in result) {
      return closed.length > 0
        ? { error: `Closed ${closed.map(c => c.label).join(', ')}, then failed on ${w.label}: ${result.error}` }
        : { error: `${w.label}: ${result.error}` }
    }
    closed.push({ id: result.id, label: w.label, netIncome: result.netIncome })
  }

  return { closed }
}

/**
 * Close a period: allocate its P&L to partners' capital, snapshot the ledger, and
 * lock the date range.
 *
 * Order matters. The fiscal period row is created OPEN, the allocation entries are
 * posted (persistEntry refuses to post into a closed period, so it must not be
 * locked yet), and only then is it marked closed. A failure part-way leaves an open
 * period with entries tagged to it, which reopening cleans up.
 */
export async function closePeriodWithAllocation(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  userId: string | null,
  periodStart: string,
  periodEnd: string,
  label?: string
): Promise<{ id: string; entryIds: string[]; netIncome: number } | { error: string }> {
  const preview = await previewClose(admin, fundId, group, periodStart, periodEnd)
  if ('error' in preview) return preview

  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const codes = await accountIdByCode(admin, fundId, group)
  const bridgeId = codes.get(BRIDGE_CODE)
  if (!bridgeId) return { error: `Missing account ${BRIDGE_CODE} (Undistributed earnings) — seed the chart of accounts first` }

  const lpIds = Array.from(new Set(preview.categories.flatMap(c => c.lines.map(l => l.lpEntityId))))
  const capMap = await ensureCapitalAccounts(admin, fundId, group, lpIds)

  // 1. The period must exist and be OPEN so the allocation entries can post into it.
  //    Reuse an existing row for this exact range — reopening leaves the row behind as
  //    a record, and inserting blindly would pile up a duplicate on every re-close.
  const { data: existingPeriod } = await admin
    .from('fiscal_periods' as any)
    .select('id')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .maybeSingle()

  let periodId: string
  if (existingPeriod) {
    periodId = (existingPeriod as any).id
    await admin.from('fiscal_periods' as any)
      .update({ status: 'open', label: label ?? null, closed_at: null, closed_by: userId })
      .eq('id', periodId).eq('fund_id', fundId)
  } else {
    const { data: periodRow, error: periodErr } = await admin
      .from('fiscal_periods' as any)
      .insert({
        fund_id: fundId,
        portfolio_group: group,
        vehicle_id: vehicleId,
        period_start: periodStart,
        period_end: periodEnd,
        label: label ?? null,
        status: 'open',
        closed_by: userId,
      })
      .select('id')
      .single()
    if (periodErr) return { error: periodErr.message }
    periodId = (periodRow as any).id
  }
  const sourceRef = `close:${periodId}`

  // 2. Post one allocation entry per category, tagged so reopening can find them.
  const entryIds: string[] = []
  for (const cat of preview.categories) {
    const postings: Posting[] = [
      // The bridge takes the whole category; each partner takes their share.
      { accountId: bridgeId, amount: roundCents(cat.capitalEffect), currency: 'USD', lpEntityId: null },
    ]
    for (const line of cat.lines) {
      if (line.amount === 0) continue
      const accountId = capMap.get(line.lpEntityId)
      if (!accountId) return { error: `No capital account for partner ${line.name}` }
      // Credit capital when the category increases it — hence the negation.
      postings.push({ accountId, amount: roundCents(-line.amount), currency: 'USD', lpEntityId: line.lpEntityId })
    }

    const entry: JournalEntry = {
      fundId,
      entryDate: periodEnd,
      memo: `${label ?? `${periodStart} → ${periodEnd}`} close — ${cat.label} allocated to partners`,
      sourceType: cat.sourceType,
      sourceRef,
      postings,
    }
    const result = await persistEntry(admin, fundId, group, userId, entry, 'posted')
    if ('error' in result) {
      // Roll back: void anything already posted and drop the period.
      await reopenPeriodWithReversal(admin, fundId, group, periodId)
      await admin.from('fiscal_periods' as any).delete().eq('id', periodId).eq('fund_id', fundId)
      return { error: `Allocation failed (${cat.label}): ${result.error}` }
    }
    entryIds.push(result.entryId)
  }

  // 3. Snapshot and lock.
  const snapshot = await exportLedgerText(admin, fundId, group, periodEnd)
  const { error: closeErr } = await admin
    .from('fiscal_periods' as any)
    .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: userId, snapshot_text: snapshot })
    .eq('id', periodId)
    .eq('fund_id', fundId)
  if (closeErr) return { error: closeErr.message }

  return { id: periodId, entryIds, netIncome: preview.netIncome }
}

/**
 * Reopen a period and reverse its allocation: void every entry the close posted
 * (found by source_ref), then unlock the range. The books return exactly to their
 * pre-close state — P&L untouched, capital accounts back to contributions only.
 */
export async function reopenPeriodWithReversal(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  periodId: string
): Promise<{ ok: true; voided: number } | { error: string }> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)

  // Periods must be reopened newest-first. A later period's allocation was computed
  // from the books as they stood AFTER this one — on a capital-balance basis it
  // literally depends on this period's allocation entries. Reopening out of order
  // would leave those later allocations silently computed from a state that no longer
  // exists.
  const { data: self } = await admin
    .from('fiscal_periods' as any)
    .select('period_end')
    .eq('id', periodId)
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .maybeSingle()
  if (!self) return { error: 'Period not found' }

  const { data: later } = await admin
    .from('fiscal_periods' as any)
    .select('period_start, period_end, label')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .eq('status', 'closed')
    .gt('period_start', (self as any).period_end)
    .order('period_start', { ascending: true })

  const blocking = ((later as any[]) ?? [])[0]
  if (blocking) {
    return {
      error: `Reopen later periods first — ${blocking.label ?? `${blocking.period_start} → ${blocking.period_end}`} is still closed, and its allocation was computed on top of this one.`,
    }
  }

  const { data: entries, error: findErr } = await admin
    .from('journal_entries' as any)
    .select('id')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .eq('source_ref', `close:${periodId}`)
    .neq('status', 'void')
  if (findErr) return { error: findErr.message }

  const ids = ((entries as any[]) ?? []).map(e => e.id)
  if (ids.length > 0) {
    // Void rather than delete: the allocation is derived, but the audit trail of
    // having closed and reopened is not.
    const { error: voidErr } = await admin
      .from('journal_entries' as any)
      .update({ status: 'void', posted_at: null })
      .in('id', ids)
      .eq('fund_id', fundId)
    if (voidErr) return { error: voidErr.message }
  }

  const { error: openErr } = await admin
    .from('fiscal_periods' as any)
    .update({ status: 'open', closed_at: null, snapshot_text: null })
    .eq('id', periodId)
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
  if (openErr) return { error: openErr.message }

  return { ok: true, voided: ids.length }
}
