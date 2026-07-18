// One health check for a vehicle's books: is it onboarded, where did the close get
// to, and what needs attention. Feeds the Status page and decides whether the
// Accounting home page still needs to show the onboarding card at all.

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPostedLedger, loadOwnership } from './load'
import { balanceSheet, scheduleOfInvestments, postingsAsOf } from './statements'
import { buildSoiPositions, type SoiCompany } from './soi'
import { computeCapitalAccounts, totalNav } from './capital-account'
import { loadHistoryMode, loadAllocationBasis, type HistoryMode, type AllocationBasis } from './terms'
import { loadCapitalSource, type CapitalSource } from './capital-source'
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
  /** 'ledger' = full Fund Accounting (double-entry books). 'events' = LP-only capital tracking,
   *  where the ledger apparatus (trial balance, bank, close, onboarding) does not apply. */
  source: CapitalSource
  onboarded: boolean
  setup: {
    chartSeeded: boolean
    accountCount: number
    historyMode: HistoryMode
    hasPostedEntries: boolean
    partnerCount: number
    partnersWithCommitment: number
    /** False only when the tracker holds positions the ledger doesn't carry. */
    investmentsBooked: boolean
  }
  investments: {
    trackerPositions: number
    trackerCost: number
    trackerFairValue: number
    ledgerCost: number
    ledgerFairValue: number
    /** Positions whose own accounts disagree with the tracker. */
    offLedger: number
  }
  ledger: {
    entryCount: number
    draftCount: number
    trialBalanced: boolean
    nav: number
    netAssets: number
    capitalTies: boolean
    capitalGap: number
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
  const source = await loadCapitalSource(admin, fundId, group)

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

  // A vehicle whose tracker holds positions the ledger doesn't carry is NOT onboarded,
  // however complete the rest of it looks. Leaving investments out of this definition
  // is what let a vehicle "finish" setup with an empty investment ledger — the setup
  // card vanished and the only hint was a blocker on Status, discovered after the fact.
  // A vehicle with no positions at all (a fresh SPV pre-investment) is fine.
  const investmentsBooked = positions.length === 0 || Math.abs(soi.ledgerCost) >= 0.005
  const onboarded = chartSeeded && !!historyMode && hasPostedEntries && investmentsBooked

  // ---------------------------------------------------------------------------
  // What needs attention, worst first.
  // ---------------------------------------------------------------------------
  const issues: StatusIssue[] = []

  if (!chartSeeded) {
    issues.push({ level: 'blocker', title: 'Chart of accounts not seeded', detail: 'Nothing can be booked until the chart exists.', href: '/funds', action: 'Seed the chart' })
  }
  if (chartSeeded && !historyMode) {
    issues.push({ level: 'blocker', title: 'Onboarding path not chosen', detail: 'Pick full history (rebuild from inception) or cutover (start at a date with opening balances).', href: '/funds', action: 'Choose a path' })
  }
  if (!bs.check || Math.abs(bs.check) > 0.004) {
    if (Math.abs(bs.check) > 0.004) {
      issues.push({ level: 'blocker', title: 'Balance sheet does not balance', detail: `Assets less liabilities and partners' capital leaves ${bs.check.toFixed(2)}. Something is booked wrong.`, href: '/funds/statements', action: 'Open the statements' })
    }
  }

  if (bankNeedsAttention > 0) {
    issues.push({
      level: 'blocker',
      title: `${bankNeedsAttention} bank transaction${bankNeedsAttention === 1 ? '' : 's'} not posted`,
      detail: 'Their income and expense is not in the ledger, so a close would allocate nothing for them — and then lock the period.',
      href: '/funds/bank',
      action: 'Categorize and post',
    })
  }
  if (draftCount > 0) {
    issues.push({
      level: 'blocker',
      title: `${draftCount} journal entr${draftCount === 1 ? 'y is' : 'ies are'} still in draft`,
      detail: 'A draft has no effect on the ledger. Post or void it before closing the period it falls in.',
      href: '/funds/journal',
      action: 'Review the journal',
    })
  }

  // The tracker knows the fund holds these companies; the ledger doesn't. Without
  // this, the balance sheet shows no investments and nobody is told why — it would
  // only surface indirectly as an SOI variance, and only once the chart was seeded.
  if (positions.length > 0 && Math.abs(soi.ledgerCost) < 0.005) {
    const trackerCost = roundCents(positions.reduce((s, p) => s + p.cost, 0))
    const trackerFv = roundCents(positions.reduce((s, p) => s + p.fairValue, 0))
    issues.push({
      level: 'blocker',
      title: 'Investments are not on the ledger',
      detail: `The portfolio tracker holds ${positions.length} ${positions.length === 1 ? 'position' : 'positions'} in this vehicle (${trackerCost.toFixed(2)} at cost, ${trackerFv.toFixed(2)} at fair value), but the ledger carries no investment balance. The balance sheet and the schedule of investments are both wrong until they're booked.`,
      href: '/funds/schedule-of-investments',
      action: 'Bootstrap investments',
    })
  } else if (soi.source === 'tracker' && (soi.costVariance !== 0 || soi.fairValueVariance !== 0)) {
    issues.push({
      level: 'warning',
      title: 'Schedule of investments does not tie to the ledger',
      detail: `Cost is off by ${soi.costVariance.toFixed(2)} and fair value by ${soi.fairValueVariance.toFixed(2)}. A mark or purchase was recorded in one system and not the other.`,
      href: '/funds/schedule-of-investments',
      action: 'Open the schedule',
    })
  }

  // Per-company accounts exist but a position disagrees with its own account.
  const offRows = soi.rows.filter(r => r.tiesOut === false)
  if (offRows.length > 0) {
    issues.push({
      level: 'warning',
      title: `${offRows.length} ${offRows.length === 1 ? 'investment does' : 'investments do'} not tie to the ledger`,
      detail: `${offRows.slice(0, 3).map(r => r.name).join(', ')}${offRows.length > 3 ? `, and ${offRows.length - 3} more` : ''}. The tracker and the ledger disagree on cost or fair value for these positions.`,
      href: '/funds/schedule-of-investments',
      action: 'Open the schedule',
    })
  }

  if (Math.abs(bs.partnersCapital.unallocatedEarnings) > 0.004) {
    issues.push({
      level: 'warning',
      title: `${bs.partnersCapital.unallocatedEarnings.toFixed(2)} of net income not allocated`,
      detail: "Fund-level statements are right, but each partner's capital account understates their NAV until the period is closed.",
      href: '/funds/periods',
      action: 'Close the period',
    })
  }

  // DOES THE SUM OF THE PARTNERS EQUAL THE FUND?
  //
  // Both halves were already computed here and never compared. The balance sheet can balance
  // perfectly while the per-partner capital accounts do NOT add up to partners' capital —
  // a posting to the pooled 3100/3000 with no lp_entity_id, or an LP entity deleted out from
  // under its postings, does exactly that. Fund-level statements stay right; every LP's
  // statement is then wrong, and nothing said so.
  //
  // The reconciling items are legitimate and expected: earnings not yet allocated to partners
  // (they sit in the bridge until the close), and GP capital held outside the LP accounts.
  const reconciled = roundCents(nav + bs.partnersCapital.unallocatedEarnings)
  const capitalGap = roundCents(bs.partnersCapital.total - reconciled)

  if (Math.abs(capitalGap) > 0.004) {
    issues.push({
      level: 'blocker',
      title: "Partners' capital doesn't tie to the sum of the partners",
      detail:
        `Partners' capital is ${bs.partnersCapital.total.toFixed(2)}, but the individual capital accounts ` +
        `plus unallocated earnings come to ${reconciled.toFixed(2)} — a gap of ${capitalGap.toFixed(2)}. ` +
        `Something is booked to partners' capital without being attributed to a partner, so every LP statement understates or overstates. ` +
        `Look for postings to the pooled capital account (3100/3000) that carry no partner.`,
      href: '/funds/journal',
      action: 'Open the journal',
    })
  }

  if (partnersWithCommitment === 0 && owners.length > 0) {
    issues.push({ level: 'warning', title: 'No partner has a commitment', detail: 'The close allocates pro-rata by commitment; with none set there is nothing to allocate on.', href: '/funds/status', action: 'Set commitments' })
  }
  if (owners.length === 0) {
    issues.push({ level: 'warning', title: 'No partners yet', detail: 'Add the LPs and GP entity that hold capital in this vehicle.', href: '/funds/capital-accounts', action: 'Add partners' })
  }

  return {
    vehicle: group,
    source,
    onboarded,
    setup: {
      chartSeeded,
      accountCount: accounts.length,
      historyMode,
      hasPostedEntries,
      partnerCount: owners.length,
      partnersWithCommitment,
      investmentsBooked,
    },
    investments: {
      trackerPositions: positions.length,
      trackerCost: roundCents(positions.reduce((s, p) => s + p.cost, 0)),
      trackerFairValue: roundCents(positions.reduce((s, p) => s + p.fairValue, 0)),
      ledgerCost: soi.ledgerCost,
      ledgerFairValue: soi.ledgerFairValue,
      offLedger: soi.rows.filter(r => r.tiesOut === false).length,
    },
    ledger: {
      entryCount: entries.length,
      draftCount,
      trialBalanced: Math.abs(bs.check) < 0.005,
      nav: roundCents(nav),
      netAssets: bs.partnersCapital.total,
      /** Does Σ per-partner capital (+ unallocated earnings) equal partners' capital?
       *  The books can balance while this does not — see the blocker above. */
      capitalTies: Math.abs(capitalGap) < 0.005,
      capitalGap,
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
