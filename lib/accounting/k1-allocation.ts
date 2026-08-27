// Partner tax allocation: capital-account activity plus fund-level character → K-1 lines.
//
// THE ONE IDEA. The period close has ALREADY allocated every dollar of income, gain and expense
// to each partner's capital account, honouring the vehicle's allocation basis and each partner's
// per-category participation (the GP entity that bears no management fee, the side letter with a
// negotiated rate). Re-deriving that split here would mean a second allocation engine that can
// disagree with the first, which is the bug this module is written to avoid.
//
// So this does NOT re-allocate. It takes each partner's already-allocated buckets and splits each
// one into its character components, using the fund-level mix for that bucket. A partner's share
// of long-term gain is their share of realized gains times the fund's long/short ratio.
//
// THE ASSUMPTION, stated because it is the thing a preparer will want to check: character is
// allocated in the same proportion as the bucket it came from. That is how the split is done in
// practice, and it is exactly right whenever every partner shares a bucket on one basis — which
// is what the close enforces. Where a fund needs a specific item allocated differently — §704(c)
// built-in gain to the contributing partner, a special allocation in the LPA — that is a
// hand-authored adjustment, and it belongs with the other things book-tax.ts refuses to invent.
//
// Amounts here are TAX basis: the caller supplies buckets read from the actual book plus the tax
// overlay, not from GAAP alone.

import { roundCents } from './ledger'
import { allocateAmount } from './allocation'

/**
 * The K-1 lines a private fund actually produces.
 *
 * Deliberately not the whole form. A line that this app cannot source is worse than an absent
 * one: it invites a preparer to trust a zero that means "never computed". Rental income,
 * guaranteed payments, §179, foreign taxes and the rest are absent for that reason.
 */
export type K1Category =
  | 'interest'
  | 'ordinaryDividends'
  | 'qualifiedDividends'
  | 'shortTermGain'
  | 'longTermGain'
  | 'otherIncome'
  | 'deductions'
  | 'distributionsCash'
  | 'distributionsProperty'
  | 'distributionsOther'

export const K1_BOX: Record<K1Category, string> = {
  interest: '5',
  ordinaryDividends: '6a',
  qualifiedDividends: '6b',
  shortTermGain: '8',
  longTermGain: '9a',
  otherIncome: '11',
  deductions: '13',
  distributionsCash: '19A',
  distributionsProperty: '19B',
  distributionsOther: '19C',
}

export const K1_CATEGORIES = Object.keys(K1_BOX) as K1Category[]

/**
 * Lines that are a SUBSET of another line rather than an addition to it.
 *
 * Qualified dividends (6b) are part of ordinary dividends (6a), not extra income. Adding them
 * into a total would overstate it, and the tie-out below is where that mistake would otherwise
 * hide.
 */
export const K1_SUBSET_OF: Partial<Record<K1Category, K1Category>> = {
  qualifiedDividends: 'ordinaryDividends',
}

export type K1Lines = Record<K1Category, number>

export function emptyLines(): K1Lines {
  return Object.fromEntries(K1_CATEGORIES.map(c => [c, 0])) as K1Lines
}

/** The fund's year, by character. Positive deductions; gains and losses signed. */
export interface FundYearCharacter {
  interest: number
  ordinaryDividends: number
  /** The qualified portion of ordinaryDividends — a subset, never added on top. */
  qualifiedDividends: number
  shortTermGain: number
  longTermGain: number
  otherIncome: number
  /** Investment expenses and management fee. Positive reduces income. */
  deductions: number
}

/**
 * One partner's already-allocated activity for the year, on a TAX basis.
 *
 * These are the close's own buckets, net of the tax overlay — so `realizedGains` excludes
 * anything still unrealized, and `carriedInterest` excludes accruals the tax book reversed.
 */
export interface PartnerYearActivity {
  lpEntityId: string
  beginningCapital: number
  contributions: number
  /** Total distributed, signed positive. */
  distributions: number
  /** Split by K-1 box 19 form. Omitted means all cash, which is what box 19 A covers. */
  distributionsByKind?: { cash: number; property: number; other: number }
  /** Interest, dividends and other ordinary income allocated to this partner. */
  operatingIncome: number
  /** Realized gains allocated to this partner. */
  realizedGains: number
  /** Management fees plus expenses, signed positive. */
  expenses: number
  /** Carried interest allocated to or from this partner, signed as the capital account holds it. */
  carriedInterest: number
  endingCapital: number
}

export interface PartnerK1 {
  lpEntityId: string
  lines: K1Lines
  capitalAccount: {
    beginning: number
    contributions: number
    distributions: number
    netIncome: number
    ending: number
  }
  /**
   * Whether the K-1's income lines reconcile to the capital account's movement.
   *
   * `computed` sums the lines (excluding subsets and distributions); `fromCapital` is what the
   * capital account says the partner earned. A variance is not corrected — it is REPORTED, the
   * same posture lots.ts takes on a disposal basis it disagrees with. A silent restatement here
   * would put a number on a K-1 that the books do not support.
   */
  tieOut: { computed: number; fromCapital: number; variance: number }
}

/** Income lines only: what the partner earned, excluding subsets and distributions. */
export function incomeTotal(lines: K1Lines): number {
  const isSubset = (c: K1Category) => c in K1_SUBSET_OF
  const isDistribution = (c: K1Category) => c.startsWith('distributions')
  return roundCents(
    K1_CATEGORIES.filter(c => !isSubset(c) && !isDistribution(c)).reduce(
      (s, c) => s + (c === 'deductions' ? -lines[c] : lines[c]),
      0,
    ),
  )
}

/**
 * Split one fund-level amount across partners in proportion to their share of a bucket.
 *
 * Uses the ledger's own cent-apportionment, so the parts tie to the total exactly and the
 * remainder lands on one partner rather than being smeared. When the bucket is empty for
 * everyone there is nothing to be proportional to, and the amount is returned unallocated —
 * the caller reports it rather than silently dropping it.
 */
function splitByBucket(
  amount: number,
  partners: PartnerYearActivity[],
  bucket: (p: PartnerYearActivity) => number,
): { allocated: Map<string, number>; unallocated: number } {
  const total = roundCents(amount)
  if (total === 0) return { allocated: new Map(), unallocated: 0 }

  // Apportionment needs non-negative weights. A negative bucket (a partner allocated a loss)
  // uses absolute size for the split, because proportion is about magnitude of participation.
  const owners = partners.map(p => ({ lpEntityId: p.lpEntityId, commitment: Math.abs(bucket(p)) }))
  const basis = owners.reduce((s, o) => s + o.commitment, 0)
  if (basis === 0) return { allocated: new Map(), unallocated: total }

  return { allocated: allocateAmount(total, owners), unallocated: 0 }
}

export interface AllocateK1Input {
  fund: FundYearCharacter
  partners: PartnerYearActivity[]
}

export interface AllocateK1Result {
  partners: PartnerK1[]
  /**
   * Fund-level amounts that had no bucket to follow — e.g. dividends in a year where no partner
   * was allocated operating income. Surfaced rather than dropped: a K-1 set that quietly omits
   * income is the failure this whole module is guarding against.
   */
  unallocated: Partial<Record<K1Category, number>>
}

export function allocateK1(input: AllocateK1Input): AllocateK1Result {
  const { fund, partners } = input
  const unallocated: Partial<Record<K1Category, number>> = {}

  const byIncome = (p: PartnerYearActivity) => p.operatingIncome
  const byGain = (p: PartnerYearActivity) => p.realizedGains
  const byExpense = (p: PartnerYearActivity) => p.expenses

  const splits: { category: K1Category; amount: number; bucket: (p: PartnerYearActivity) => number }[] = [
    { category: 'interest', amount: fund.interest, bucket: byIncome },
    { category: 'ordinaryDividends', amount: fund.ordinaryDividends, bucket: byIncome },
    { category: 'qualifiedDividends', amount: fund.qualifiedDividends, bucket: byIncome },
    { category: 'otherIncome', amount: fund.otherIncome, bucket: byIncome },
    { category: 'shortTermGain', amount: fund.shortTermGain, bucket: byGain },
    { category: 'longTermGain', amount: fund.longTermGain, bucket: byGain },
    { category: 'deductions', amount: fund.deductions, bucket: byExpense },
  ]

  const allocatedByCategory = new Map<K1Category, Map<string, number>>()
  for (const s of splits) {
    const { allocated, unallocated: left } = splitByBucket(s.amount, partners, s.bucket)
    allocatedByCategory.set(s.category, allocated)
    if (left !== 0) unallocated[s.category] = left
  }

  const out: PartnerK1[] = partners.map(p => {
    const lines = emptyLines()
    for (const [category, map] of Array.from(allocatedByCategory.entries())) {
      lines[category] = roundCents(map.get(p.lpEntityId) ?? 0)
    }

    // Distributions are the partner's own frozen amounts, not a share of anything — they were
    // declared per partner in the first place.
    const kinds = p.distributionsByKind ?? { cash: p.distributions, property: 0, other: 0 }
    lines.distributionsCash = roundCents(kinds.cash)
    lines.distributionsProperty = roundCents(kinds.property)
    lines.distributionsOther = roundCents(kinds.other)

    // What the capital account says the partner earned this year: income and gains less what they
    // bore, with carry moving between partners rather than in or out of the fund.
    const fromCapital = roundCents(
      p.operatingIncome + p.realizedGains - p.expenses - p.carriedInterest,
    )
    const computed = incomeTotal(lines)

    return {
      lpEntityId: p.lpEntityId,
      lines,
      capitalAccount: {
        beginning: roundCents(p.beginningCapital),
        contributions: roundCents(p.contributions),
        distributions: roundCents(p.distributions),
        netIncome: fromCapital,
        ending: roundCents(p.endingCapital),
      },
      tieOut: { computed, fromCapital, variance: roundCents(computed - fromCapital) },
    }
  })

  return { partners: out, unallocated }
}

/**
 * Does the partner's capital account foot?
 *
 * beginning + contributions − distributions + net income = ending. Reported, never repaired: an
 * item L that has been forced to balance tells a preparer nothing about whether the books do.
 */
export function capitalAccountFoots(k1: PartnerK1): { expected: number; actual: number; variance: number } {
  const { beginning, contributions, distributions, netIncome, ending } = k1.capitalAccount
  const expected = roundCents(beginning + contributions - distributions + netIncome)
  return { expected, actual: ending, variance: roundCents(ending - expected) }
}
