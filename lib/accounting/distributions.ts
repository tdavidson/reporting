// Declaring a distribution — the outbound mirror of issuing a capital call.
//
// Declaring reduces each partner's capital and parks the obligation on 2300 Distributions
// payable. The wire that follows settles the payable, which is what lets a bank transaction be
// matched back to the declaration that authorized it.
//
// THE REGISTER. This originally had no table — the journal entry was the record and the
// outstanding balance derived from it. That was wrong, and notices are what proved it: the 2300
// payable is CLEARED as wires go out, so once a distribution is paid the ledger no longer says
// what was declared. A notice states an amount a partner was told they would receive, and that
// figure has to survive its own payment. `distribution_lines.amount` is that frozen figure.

import type { SupabaseClient } from '@supabase/supabase-js'
import { roundCents } from './ledger'
import { allocateAmount } from './allocation'
import { accountIdByCode, ensureCapitalAccounts, persistEntry } from './persist'
import { DISTRIBUTION_PAYABLE_CODE } from './chart'
import { buildDistributionDeclarationEntry } from './entries'
import { loadPostedLedger, loadEntityNames } from './load'
import { computeCapitalAccounts } from './capital-account'
import { vehicleIdByName } from './vehicle-id'
import {
  UNCHARACTERISED,
  characterForLine,
  characterFromRow,
  isDistributionKind,
  isUncharacterised,
  validateCharacter,
  type DistributionCharacter,
  type DistributionKind,
} from './distribution-character'

export interface DistributionLineInput { lpEntityId: string; amount: number }

export interface DeclareDistributionInput {
  distributionDate: string
  description?: string | null
  scope?: 'fund_wide' | 'per_lp'
  lines: DistributionLineInput[]
  /** K-1 box 19 form. Defaults to cash, which is every distribution this app can yet produce. */
  kind?: DistributionKind
  /** Return of capital / realized gain / income. Omitted or all-zero leaves it uncharacterised. */
  character?: DistributionCharacter
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
): Promise<{ entryId: string; distributionId: string } | { error: string }> {
  const lines = (input.lines ?? []).filter(l => l.lpEntityId && Number(l.amount) > 0)
  if (lines.length === 0) return { error: 'A distribution needs at least one partner with a positive amount' }
  if (!input.distributionDate) return { error: 'A distribution date is required' }

  // Validate the character BEFORE anything is posted: a split that disagrees with what the
  // partners are being told they will receive is two claims about one wire, and the cheap moment
  // to refuse is before the journal entry exists.
  const character = input.character ?? UNCHARACTERISED
  const declaredTotal = roundCents(lines.reduce((s, l) => s + Number(l.amount), 0))
  const characterProblem = validateCharacter(character, declaredTotal)
  if (characterProblem) return { error: characterProblem.error }

  const kind: DistributionKind = isDistributionKind(input.kind) ? input.kind : 'cash'

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

  // The register, written in the same shape as issueCapitalCall's.
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const { data: row, error: regErr } = await (admin as any)
    .from('distributions')
    .insert({
      fund_id: fundId,
      vehicle_id: vehicleId,
      distribution_date: input.distributionDate,
      description: input.description ?? null,
      scope: input.scope === 'per_lp' ? 'per_lp' : 'fund_wide',
      status: 'declared',
      journal_entry_id: result.entryId,
      kind,
      char_return_of_capital: character.returnOfCapital,
      char_realized_gain: character.realizedGain,
      char_income: character.income,
      created_by: userId,
    })
    .select('id')
    .single()
  if (regErr) return { error: regErr.message }
  const distributionId = (row as any).id

  const { error: lineErr } = await (admin as any).from('distribution_lines').insert(
    Array.from(perLp.entries()).map(([lpEntityId, amount]) => ({
      distribution_id: distributionId,
      fund_id: fundId,
      vehicle_id: vehicleId,
      lp_entity_id: lpEntityId,
      amount,
    }))
  )
  if (lineErr) return { error: lineErr.message }

  return { entryId: result.entryId, distributionId }
}

export interface DeclaredDistribution {
  distributionId: string
  entryId: string | null
  date: string
  description: string | null
  total: number
  /** K-1 box 19 form. */
  kind: DistributionKind
  /** The three buckets as declared. All zero = never characterised, which is not the same as nil. */
  character: DistributionCharacter
  /** False when the distribution predates the character columns, or was declared without a split. */
  characterised: boolean
  /**
   * What each partner was DECLARED, frozen at declaration, with their share of each character
   * bucket derived from it — never stored, so the two cannot disagree.
   */
  lines: { lpEntityId: string; name: string; amount: number; character: DistributionCharacter }[]
}

/**
 * Declared distributions, newest first, from the REGISTER.
 *
 * Read from `distribution_lines`, not from the 2300 payable: the payable tells you what is
 * still owed, which is zero once everyone has been paid. The register tells you what was
 * declared, which is what a notice restates and what an LP will hold you to.
 */
export async function listDistributions(
  admin: SupabaseClient,
  fundId: string,
  group: string,
): Promise<DeclaredDistribution[]> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const [{ data: rows }, names] = await Promise.all([
    (admin as any)
      .from('distributions')
      .select('id, distribution_date, description, status, journal_entry_id, kind, char_return_of_capital, char_realized_gain, char_income, distribution_lines(lp_entity_id, amount)')
      .eq('fund_id', fundId)
      .eq('vehicle_id', vehicleId)
      .order('distribution_date', { ascending: false })
      .limit(200),
    loadEntityNames(admin, fundId, group),
  ])

  return ((rows as any[]) ?? []).map(d => {
    const character = characterFromRow(d)
    const rawLines = (d.distribution_lines ?? []).map((l: any) => ({
      lpEntityId: l.lp_entity_id,
      name: names.get(l.lp_entity_id) ?? l.lp_entity_id,
      amount: roundCents(Number(l.amount)),
    }))
    const total = roundCents(rawLines.reduce((s: number, l: any) => s + l.amount, 0))
    return {
      distributionId: d.id,
      entryId: d.journal_entry_id,
      date: d.distribution_date,
      description: d.description ?? null,
      total,
      kind: isDistributionKind(d.kind) ? d.kind : 'cash',
      character,
      characterised: !isUncharacterised(character),
      lines: rawLines.map((l: any) => ({ ...l, character: characterForLine(character, l.amount, total) })),
    }
  })
}
