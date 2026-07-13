// One health check for a vehicle's books: is it onboarded, where did the close get
// to, and what needs attention. Feeds the Status page and decides whether the
// Accounting home page still needs to show the onboarding card at all.

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPostedLedger, loadOwnership } from './load'
import { balanceSheet, scheduleOfInvestments, postingsAsOf } from './statements'
import { buildSoiPositions, type SoiCompany } from './soi'
import { computeCapitalAccounts, totalNav } from './capital-account'
import { loadHistoryMode, loadAllocationBasis, type HistoryMode, type AllocationBasis } from './terms'
import { nextCloseStart } from './close'
import { vehicleIdByName } from './vehicle-id'
import { roundCents } from './ledger'

export type IssueLevel = 'blocker' | 'warning' | 'info'

export interface StatusIssue {
  level: IssueLevel
  title: string
  detail: string
  /** Where to go to fix it. */
  href?: string
  action?: string
}

export interface VehicleStatus {
  vehicle: string
  onboarded: boolean
  setup: {
    chartSeeded: boolean
    accountCount: number
    historyMode: HistoryMode
    hasPostedEntries: boolean
    partnerCount: number
    partnersWithCommitment: number
  }
  ledger: {
    entryCount: number
    draftCount: number
    trialBalanced: boolean
    nav: number
    netAssets: number
  }
  close: {
    basis: AllocationBasis
    lastClosedEnd: string | null
    lastClosedLabel: string | null
    /** Where the next close would begin. Null = nothing to close. */
    nextStart: string | null
    unallocatedEarnings: number
  }
  bank: {
    total: number
    needsAttention: number
  }
  issues: StatusIssue[]
}

export async function vehicleStatus(
  admin: SupabaseClient,
  fundId: string,
  group: string
): Promise<VehicleStatus> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)

  const [
    { accounts, postings, capitalPostings },
    owners,
    historyMode,
    basis,
    { data: entryRows },
    { data: bankRows },
    { data: periodRows },
    { data: txns },
    { data: companies },
  ] = await Promise.all([
    loadPostedLedger(admin, fundId, group),
    loadOwnership(admin, fundId, group),
    loadHistoryMode(admin, fundId, group),
    loadAllocationBasis(admin, fundId, group),
    admin.from('journal_entries' as any).select('id, status').eq('fund_id', fundId).eq('vehicle_id', vehicleId).neq('status', 'void'),
    admin.from('bank_transactions' as any).select('id, status').eq('fund_id', fundId).eq('vehicle_id', vehicleId),
    admin.from('fiscal_periods' as any).select('period_end, label').eq('fund_id', fundId).eq('vehicle_id', vehicleId).eq('status', 'closed').order('period_end', { ascending: false }).limit(1),
    admin.from('investment_transactions' as any).select('*').eq('fund_id', fundId),
    admin.from('companies' as any).select('*').eq('fund_id', fundId),
  ])

  const entries = ((entryRows as any[]) ?? [])
  const bank = ((bankRows as any[]) ?? [])
  const draftCount = entries.filter(e => e.status === 'draft').length
  const postedCount = entries.filter(e => e.status === 'posted').length
  const bankNeedsAttention = bank.filter(t => t.status === 'unmatched' || t.status === 'drafted').length

  const bs = balanceSheet(accounts, postingsAsOf(postings, null))
  const capitalAccounts = computeCapitalAccounts(capitalPostings)
  const nav = totalNav(capitalAccounts)

  const positions = buildSoiPositions((txns as any[]) ?? [], ((companies as any[]) ?? []) as SoiCompany[], group)
  const soi = scheduleOfInvestments(accounts, postings, nav, positions)

  const lastClosed = ((periodRows as any[]) ?? [])[0] ?? null
  const nextStart = await nextCloseStart(admin, fundId, group)

  const partnersWithCommitment = owners.filter(o => o.commitment > 0).length

  const chartSeeded = accounts.length > 0
  const hasPostedEntries = postedCount > 0
  const onboarded = chartSeeded && !!historyMode && hasPostedEntries

  // ---------------------------------------------------------------------------
  // What needs attention, worst first.
  // ---------------------------------------------------------------------------
  const issues: StatusIssue[] = []

  if (!chartSeeded) {
    issues.push({ level: 'blocker', title: 'Chart of accounts not seeded', detail: 'Nothing can be booked until the chart exists.', href: '/accounting', action: 'Seed the chart' })
  }
  if (chartSeeded && !historyMode) {
    issues.push({ level: 'blocker', title: 'Onboarding path not chosen', detail: 'Pick full history (rebuild from inception) or cutover (start at a date with opening balances).', href: '/accounting', action: 'Choose a path' })
  }
  if (!bs.check || Math.abs(bs.check) > 0.004) {
    if (Math.abs(bs.check) > 0.004) {
      issues.push({ level: 'blocker', title: 'Balance sheet does not balance', detail: `Assets less liabilities and partners' capital leaves ${bs.check.toFixed(2)}. Something is booked wrong.`, href: '/accounting/statements', action: 'Open the statements' })
    }
  }

  if (bankNeedsAttention > 0) {
    issues.push({
      level: 'blocker',
      title: `${bankNeedsAttention} bank transaction${bankNeedsAttention === 1 ? '' : 's'} not posted`,
      detail: 'Their income and expense is not in the ledger, so a close would allocate nothing for them — and then lock the period.',
      href: '/accounting/bank',
      action: 'Categorize and post',
    })
  }
  if (draftCount > 0) {
    issues.push({
      level: 'blocker',
      title: `${draftCount} journal entr${draftCount === 1 ? 'y is' : 'ies are'} still in draft`,
      detail: 'A draft has no effect on the ledger. Post or void it before closing the period it falls in.',
      href: '/accounting/journal',
      action: 'Review the journal',
    })
  }

  if (soi.source === 'tracker' && (soi.costVariance !== 0 || soi.fairValueVariance !== 0)) {
    issues.push({
      level: 'warning',
      title: 'Schedule of investments does not tie to the ledger',
      detail: `Cost is off by ${soi.costVariance.toFixed(2)} and fair value by ${soi.fairValueVariance.toFixed(2)}. A mark or purchase was recorded in one system and not the other.`,
      href: '/accounting/schedule-of-investments',
      action: 'Open the schedule',
    })
  }

  if (Math.abs(bs.partnersCapital.unallocatedEarnings) > 0.004) {
    issues.push({
      level: 'warning',
      title: `${bs.partnersCapital.unallocatedEarnings.toFixed(2)} of net income not allocated`,
      detail: "Fund-level statements are right, but each partner's capital account understates their NAV until the period is closed.",
      href: '/accounting/periods',
      action: 'Close the period',
    })
  }

  if (partnersWithCommitment === 0 && owners.length > 0) {
    issues.push({ level: 'warning', title: 'No partner has a commitment', detail: 'The close allocates pro-rata by commitment; with none set there is nothing to allocate on.', href: '/accounting/allocation-terms', action: 'Set commitments' })
  }
  if (owners.length === 0) {
    issues.push({ level: 'warning', title: 'No partners yet', detail: 'Add the LPs and GP entity that hold capital in this vehicle.', href: '/accounting/capital-accounts', action: 'Add partners' })
  }

  return {
    vehicle: group,
    onboarded,
    setup: {
      chartSeeded,
      accountCount: accounts.length,
      historyMode,
      hasPostedEntries,
      partnerCount: owners.length,
      partnersWithCommitment,
    },
    ledger: {
      entryCount: entries.length,
      draftCount,
      trialBalanced: Math.abs(bs.check) < 0.005,
      nav: roundCents(nav),
      netAssets: bs.partnersCapital.total,
    },
    close: {
      basis,
      lastClosedEnd: lastClosed?.period_end ?? null,
      lastClosedLabel: lastClosed?.label ?? null,
      nextStart,
      unallocatedEarnings: bs.partnersCapital.unallocatedEarnings,
    },
    bank: { total: bank.length, needsAttention: bankNeedsAttention },
    issues,
  }
}
