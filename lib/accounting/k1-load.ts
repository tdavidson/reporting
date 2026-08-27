// Reading a vehicle's tax year into the two inputs the K-1 allocation needs.
//
// k1-allocation.ts is pure and knows nothing about a database. This is the part that does: it
// loads each partner's capital activity on a TAX basis, and the fund's income by character, and
// hands both over.
//
// THE CROSS-BOOK READ. Everything else in this codebase reads the actual book alone. This does
// not, and it is the first place that legitimately shouldn't: a tax-basis capital account is
// `actual + tax adjustments`, which is the whole point of the overlay. The read is registered in
// books.test.ts's exemption list with that reason, so it stays a decision rather than an
// oversight.

import type { SupabaseClient } from '@supabase/supabase-js'
import { roundCents } from './ledger'
import { computeCapitalAccounts, type CapitalPosting } from './capital-account'
import { fetchAllRows } from './load'
import { vehicleIdByName } from './vehicle-id'
import { disposalBasis, isLotMethod, type LotMethod } from '@/lib/portfolio/lots'
import { splitGains, type DisposalGain, type GainSplit } from './holding-period'
import type { FundYearCharacter, PartnerYearActivity } from './k1-allocation'

/** Income accounts, by the character a K-1 wants them under. */
const INCOME_CODES = {
  realizedGain: '4000',
  interestAndDividends: '4100',
  noteInterest: '4110',
  portfolioIncome: '4120',
} as const

const EXPENSE_CODES = {
  managementFee: '5000',
  partnershipExpense: '5100',
  organizational: '5200',
  syndication: '5250',
  interest: '5300',
} as const

export interface K1YearInputs {
  fund: FundYearCharacter
  partners: PartnerYearActivity[]
  /** Gain the lot method could not date. Reported, never assigned to a holding period. */
  undeterminedGain: number
  /**
   * Character the books cannot supply, with the reason.
   *
   * Not an error and not a zero: a preparer needs to know which lines were never computed, as
   * distinct from computed and found to be nil.
   */
  notDerivable: { line: string; reason: string }[]
}

/**
 * Load one tax year for one vehicle.
 *
 * Reads the actual book and the tax book together — see the note at the top of this file.
 */
export async function loadK1Year(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  taxYear: number,
): Promise<K1YearInputs | { error: string }> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) return { error: `Unknown vehicle "${group}"` }

  const yearStart = `${taxYear}-01-01`
  const yearEnd = `${taxYear}-12-31`

  const { data: accts } = await admin
    .from('chart_of_accounts' as any)
    .select('id, code, lp_entity_id')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
  const acctRows = (accts as any[]) ?? []
  const codeById = new Map(acctRows.map(a => [a.id as string, a.code as string]))

  // BOTH BOOKS. Tax basis is the actual ledger plus the tax overlay; reading either alone gives a
  // number that is precisely wrong. See books.test.ts CROSS_BOOK_READS.
  const postingRows = await fetchAllRows<any>((from, to) =>
    admin
      .from('journal_postings' as any)
      .select('account_id, amount, lp_entity_id, book, journal_entries!inner(entry_date, status, source_type, book)')
      .in('book', ['actual', 'tax'])
      .eq('fund_id', fundId)
      .eq('vehicle_id', vehicleId)
      .range(from, to),
  )

  const posted = postingRows.filter(r => r.journal_entries?.status === 'posted')

  // --- Partner activity -----------------------------------------------------
  const capitalPostings: CapitalPosting[] = posted
    .filter(r => r.lp_entity_id)
    .map(r => ({
      lpEntityId: r.lp_entity_id as string,
      amount: Number(r.amount),
      sourceType: r.journal_entries?.source_type ?? null,
      entryDate: r.journal_entries?.entry_date ?? null,
    }))

  const accounts = computeCapitalAccounts(capitalPostings, { start: yearStart, end: yearEnd })
  const distributionKinds = await loadDistributionKinds(admin, fundId, vehicleId, yearStart, yearEnd)

  const partners: PartnerYearActivity[] = Array.from(accounts.entries()).map(([lpEntityId, a]) => ({
    lpEntityId,
    beginningCapital: a.beginning,
    contributions: a.contributions,
    // The capital account holds distributions as a debit (positive reduces capital); the K-1
    // wants the magnitude.
    distributions: Math.abs(a.distributions),
    distributionsByKind: distributionKinds.get(lpEntityId),
    operatingIncome: a.operatingIncome,
    realizedGains: a.realizedGains,
    expenses: Math.abs(a.managementFees) + Math.abs(a.expenses),
    carriedInterest: a.carriedInterest,
    endingCapital: a.ending,
  }))

  // --- Fund character -------------------------------------------------------
  const inYear = (r: any) =>
    r.journal_entries?.entry_date >= yearStart && r.journal_entries?.entry_date <= yearEnd
  const onCode = (r: any, code: string) => codeById.get(r.account_id) === code
  // Income accounts are credited, so a credit balance is negative under this ledger's sign
  // convention. Income is the negation.
  const incomeOn = (code: string) =>
    roundCents(-posted.filter(r => inYear(r) && onCode(r, code)).reduce((s, r) => s + Number(r.amount), 0))
  const expenseOn = (code: string) =>
    roundCents(posted.filter(r => inYear(r) && onCode(r, code)).reduce((s, r) => s + Number(r.amount), 0))

  const dividends = await loadDividendIncome(admin, fundId, vehicleId, yearStart, yearEnd)
  const interestAndDividends = incomeOn(INCOME_CODES.interestAndDividends)

  // 4100 is "Interest AND dividend income" — one account for two K-1 boxes. The portfolio side
  // can tell them apart, because a dividend arrives as an `income` transaction tagged as one.
  // Whatever 4100 holds beyond those tagged dividends is interest.
  const interest = roundCents(interestAndDividends - dividends + incomeOn(INCOME_CODES.noteInterest))

  const gains = await loadRealizedGainSplit(admin, fundId, vehicleId, taxYear)

  const deductions = roundCents(
    expenseOn(EXPENSE_CODES.managementFee) +
      expenseOn(EXPENSE_CODES.partnershipExpense) +
      expenseOn(EXPENSE_CODES.organizational) +
      expenseOn(EXPENSE_CODES.syndication) +
      expenseOn(EXPENSE_CODES.interest),
  )

  const notDerivable: { line: string; reason: string }[] = [
    {
      line: 'Qualified dividends (6b)',
      reason:
        'Whether a dividend is qualified depends on the payer and on the holding period of the ' +
        'shares at the dividend date. Neither is in these books, so this is left for the ' +
        'preparer rather than reported as nil.',
    },
  ]
  if (gains.undetermined !== 0) {
    notDerivable.push({
      line: 'Short/long-term split (8, 9a)',
      reason:
        `${gains.undetermined.toFixed(2)} of realized gain could not be dated — the vehicle uses ` +
        'average cost, or a disposal drew on units no lot supplied.',
    })
  }

  return {
    fund: {
      interest,
      ordinaryDividends: dividends,
      qualifiedDividends: 0,
      shortTermGain: gains.shortTerm,
      longTermGain: gains.longTerm,
      otherIncome: incomeOn(INCOME_CODES.portfolioIncome),
      deductions,
    },
    partners,
    undeterminedGain: gains.undetermined,
    notDerivable,
  }
}

/** Each partner's distributions for the year, split by K-1 box 19 form. */
async function loadDistributionKinds(
  admin: SupabaseClient,
  fundId: string,
  vehicleId: string,
  yearStart: string,
  yearEnd: string,
): Promise<Map<string, { cash: number; property: number; other: number }>> {
  const { data } = await admin
    .from('distributions' as any)
    .select('kind, distribution_lines(lp_entity_id, amount)')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .gte('distribution_date', yearStart)
    .lte('distribution_date', yearEnd)

  const out = new Map<string, { cash: number; property: number; other: number }>()
  for (const d of ((data as any[]) ?? [])) {
    const bucket = d.kind === 'in_kind' ? 'property' : d.kind === 'other' ? 'other' : 'cash'
    for (const l of (d.distribution_lines ?? [])) {
      const cur = out.get(l.lp_entity_id) ?? { cash: 0, property: 0, other: 0 }
      cur[bucket] = roundCents(cur[bucket] + Number(l.amount))
      out.set(l.lp_entity_id, cur)
    }
  }
  return out
}

/** Dividend income recognised in the year, from the portfolio side's tagged income rows. */
async function loadDividendIncome(
  admin: SupabaseClient,
  fundId: string,
  vehicleId: string,
  yearStart: string,
  yearEnd: string,
): Promise<number> {
  const { data } = await admin
    .from('investment_transactions' as any)
    .select('income_amount, income_kind, transaction_date')
    .eq('fund_id', fundId)
    .eq('transaction_type', 'income')
    .eq('income_kind', 'dividend')
    .gte('transaction_date', yearStart)
    .lte('transaction_date', yearEnd)
  return roundCents(((data as any[]) ?? []).reduce((s, r) => s + Number(r.income_amount ?? 0), 0))
}

/** Realized gain for the year, split short/long by the lots each disposal consumed. */
async function loadRealizedGainSplit(
  admin: SupabaseClient,
  fundId: string,
  vehicleId: string,
  taxYear: number,
): Promise<GainSplit> {
  const { data: settings } = await admin
    .from('fund_settings' as any)
    .select('lot_method')
    .eq('fund_id', fundId)
    .maybeSingle()
  const raw = (settings as any)?.lot_method
  const method: LotMethod = isLotMethod(raw) ? raw : 'fifo'

  // Every transaction for the fund's companies: lots are built from the full history, because a
  // disposal in this year can consume a lot bought in any prior one.
  const txns = await fetchAllRows<any>((from, to) =>
    admin
      .from('investment_transactions' as any)
      .select('*')
      .eq('fund_id', fundId)
      .range(from, to),
  )

  const byCompany = new Map<string, any[]>()
  for (const t of txns) {
    const key = t.company_id as string
    if (!key) continue
    const list = byCompany.get(key) ?? []
    list.push(t)
    byCompany.set(key, list)
  }

  const yearStart = `${taxYear}-01-01`
  const yearEnd = `${taxYear}-12-31`
  const disposals: DisposalGain[] = []

  for (const rows of Array.from(byCompany.values())) {
    const bases = disposalBasis(rows as any, method)
    const proceedsByTxn = new Map<string, number>(
      rows
        .filter(r => r.transaction_type === 'proceeds')
        .map(r => [r.id as string, Number(r.proceeds_received ?? 0) + Number(r.proceeds_escrow ?? 0)]),
    )
    for (const b of bases) {
      if (b.date < yearStart || b.date > yearEnd) continue
      disposals.push({ basis: b, proceeds: proceedsByTxn.get(b.txnId) ?? 0 })
    }
  }

  return splitGains(disposals)
}
