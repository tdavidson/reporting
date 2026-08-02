// Declaring a distribution — the outbound mirror of issuing a capital call.
//
// Declaring reduces each partner's capital and parks the obligation on 2300 Distributions
// payable. The wire that follows settles the payable, which is what lets a bank transaction be
// matched back to the declaration that authorized it.
//
// Deliberately NO `distributions` table. A call has one because `capital_calls` predates the
// ledger being authoritative; here the journal entry IS the record and the outstanding balance
// derives from it (`lpPayableBalances`). A second store would only be something to disagree.

import type { SupabaseClient } from '@supabase/supabase-js'
import { roundCents } from './ledger'
import { allocateAmount } from './allocation'
import { accountIdByCode, ensureCapitalAccounts, persistEntry } from './persist'
import { DISTRIBUTION_PAYABLE_CODE } from './chart'
import { buildDistributionDeclarationEntry } from './entries'
import { loadPostedLedger, loadEntityNames } from './load'
import { computeCapitalAccounts } from './capital-account'
import { vehicleIdByName } from './vehicle-id'

export interface DistributionLineInput { lpEntityId: string; amount: number }

export interface DeclareDistributionInput {
  distributionDate: string
  description?: string | null
  lines: DistributionLineInput[]
}

/**
 * Split a total across partners by ENDING CAPITAL BALANCE.
 *
 * Not by commitment — you distribute what a partner owns, not what they promised. A partner
 * who funded 10% of the capital but committed 20% is owed a share of the proceeds
 * proportional to the former. (A capital call is the mirror and correctly uses commitment.)
 */
export async function proRataDistribution(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  total: number,
): Promise<DistributionLineInput[]> {
  const { capitalPostings } = await loadPostedLedger(admin, fundId, group)
  const basis = Array.from(computeCapitalAccounts(capitalPostings).entries())
    .map(([lpEntityId, a]) => ({ lpEntityId, commitment: a.ending }))
    .filter(o => o.commitment > 0)
  if (basis.length === 0) return []
  return Array.from(allocateAmount(total, basis).entries()).map(([lpEntityId, amount]) => ({ lpEntityId, amount }))
}

/** Declare a distribution: Dr each partner's capital, Cr Distributions payable. */
export async function declareDistribution(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  userId: string | null,
  input: DeclareDistributionInput,
): Promise<{ entryId: string } | { error: string }> {
  const lines = (input.lines ?? []).filter(l => l.lpEntityId && Number(l.amount) > 0)
  if (lines.length === 0) return { error: 'A distribution needs at least one partner with a positive amount' }
  if (!input.distributionDate) return { error: 'A distribution date is required' }

  const codes = await accountIdByCode(admin, fundId, group)
  const payableId = codes.get(DISTRIBUTION_PAYABLE_CODE)
  if (!payableId) {
    return { error: `Seed the chart of accounts first (missing ${DISTRIBUTION_PAYABLE_CODE} Distributions payable) — use Sync accounts on the vehicle's Setup page` }
  }

  const capMap = await ensureCapitalAccounts(admin, fundId, group, lines.map(l => l.lpEntityId))
  const perLp = new Map<string, number>()
  for (const l of lines) perLp.set(l.lpEntityId, roundCents((perLp.get(l.lpEntityId) ?? 0) + Number(l.amount)))

  const entry = buildDistributionDeclarationEntry(
    { fundId, entryDate: input.distributionDate, memo: input.description || 'Distribution' },
    perLp,
    capMap,
    payableId,
  )
  // Posted, like a call issuance: declaring is the event. The SETTLEMENT is what arrives as a
  // draft later, from the bank.
  const result = await persistEntry(admin, fundId, group, userId, entry, 'posted')
  if ('error' in result) return { error: result.error }
  return { entryId: result.entryId }
}

export interface DeclaredDistribution {
  entryId: string
  date: string
  description: string | null
  total: number
  /** Still owed across all partners on this declaration's account. */
  lines: { lpEntityId: string; name: string; amount: number }[]
}

/** Declared distributions, newest first, derived from the ledger. */
export async function listDistributions(
  admin: SupabaseClient,
  fundId: string,
  group: string,
): Promise<DeclaredDistribution[]> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const codes = await accountIdByCode(admin, fundId, group)
  const payableId = codes.get(DISTRIBUTION_PAYABLE_CODE)
  if (!payableId) return []

  const [{ data: entries }, names] = await Promise.all([
    (admin as any)
      .from('journal_entries')
      .select('id, entry_date, memo, status, journal_postings(account_id, amount, lp_entity_id)')
      .eq('fund_id', fundId)
      .eq('vehicle_id', vehicleId)
      .eq('source_type', 'distribution')
      .neq('status', 'void')
      .order('entry_date', { ascending: false })
      .limit(200),
    loadEntityNames(admin, fundId, group),
  ])

  return ((entries as any[]) ?? [])
    .map(e => {
      const payableLines = (e.journal_postings ?? []).filter((p: any) => p.account_id === payableId && p.lp_entity_id)
      const lines = payableLines.map((p: any) => ({
        lpEntityId: p.lp_entity_id,
        name: names.get(p.lp_entity_id) ?? p.lp_entity_id,
        amount: roundCents(-Number(p.amount)), // credit-normal → what is owed
      }))
      return {
        entryId: e.id,
        date: e.entry_date,
        description: e.memo ?? null,
        total: roundCents(lines.reduce((s: number, l: any) => s + l.amount, 0)),
        lines,
      }
    })
    // Only declarations — a pre-payable distribution booked straight to cash has no 2300 line.
    .filter(d => d.lines.length > 0)
}
