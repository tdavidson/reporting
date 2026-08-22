import type { InvestmentTransaction } from '@/lib/types/database'

// ---------------------------------------------------------------------------
// Share splits
//
// A split changes the share COUNT and the per-share PRICE and leaves the position's VALUE
// alone. Everything here follows from that invariant: for any share-denominated figure
// observed on a date, apply the ratio of every split effective after it — multiplying
// quantities, dividing prices — and `shares x price` comes out identical.
//
// WHY A PRE-PASS RATHER THAN A BRANCH IN computeSummary. The roll-up reads share counts and
// per-share prices in a dozen places (round basis, the priced-equity path, the latest-price
// determination, the round fallback). Adjusting at each of them is a dozen chances to miss
// one, and a miss is silent: the position simply reports the wrong value. Normalizing the
// transactions ONCE, before any of that runs, means the roll-up needs no knowledge of splits
// at all — it sees a history that was always expressed in today's shares.
// ---------------------------------------------------------------------------

export interface SplitEvent {
  /** Effective date. Shares trade split-adjusted from this date on. */
  date: string
  /** New shares per old share. 2-for-1 forward = 2; 1-for-10 reverse = 0.1. */
  ratio: number
}

/** Split rows, in date order. Rows without a usable ratio or date are dropped — the DB
 *  constraints reject both, so this only ever discards pre-constraint or hand-made data. */
export function splitsFrom(txns: InvestmentTransaction[]): SplitEvent[] {
  return txns
    .filter(t => t.transaction_type === 'split')
    .map(t => ({ date: t.transaction_date as string, ratio: Number((t as any).split_ratio) }))
    .filter(s => !!s.date && Number.isFinite(s.ratio) && s.ratio > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * How many of today's shares one share held on `date` has become.
 *
 * STRICTLY AFTER, not on-or-after: a split's effective date is the first date on which the
 * stock trades split-adjusted, so a purchase made ON that date is already in new shares at
 * the new price and must not be adjusted again. Off-by-one here doubles a position.
 */
export function cumulativeFactor(splits: SplitEvent[], date: string | null): number {
  if (!date) return 1
  let factor = 1
  for (const s of splits) if (s.date > date) factor *= s.ratio
  return factor
}

/**
 * Share-bearing rows a split cannot be applied to, because they carry no date.
 *
 * These are NOT adjusted — there is no way to know which side of the split they fall on, and
 * a guess would silently misstate the position either way. The close surfaces this instead:
 * an unadjusted row is a wrong share count, and the fund should be told rather than shown a
 * confident number. Returns the offending transaction ids.
 */
export function undatedShareRows(txns: InvestmentTransaction[]): string[] {
  if (splitsFrom(txns).length === 0) return []
  return txns
    .filter(t => !t.transaction_date)
    .filter(t => (t.shares_acquired ?? 0) > 0 || (t.share_price ?? 0) > 0 || (t.current_share_price ?? 0) > 0)
    .map(t => t.id)
    .filter(Boolean) as string[]
}

/**
 * Restate a transaction history in today's shares.
 *
 * Only the three fields that FEED VALUATION are touched: `shares_acquired`, `share_price` and
 * `current_share_price`. The historical-record columns (`proceeds_per_share`, and every
 * `original_*` FX column) are deliberately left alone — they record what was actually paid or
 * received per share on the day, and a later split does not retroactively change that. They
 * are display and audit fields; no valuation path reads them.
 *
 * Returns the input array unchanged when there are no splits, so the overwhelmingly common
 * case allocates nothing.
 */
export function splitAdjust(txns: InvestmentTransaction[]): InvestmentTransaction[] {
  const splits = splitsFrom(txns)
  if (splits.length === 0) return txns

  return txns.map(t => {
    const factor = cumulativeFactor(splits, t.transaction_date)
    if (factor === 1) return t
    return {
      ...t,
      shares_acquired: t.shares_acquired == null ? t.shares_acquired : t.shares_acquired * factor,
      share_price: t.share_price == null ? t.share_price : t.share_price / factor,
      current_share_price: t.current_share_price == null ? t.current_share_price : t.current_share_price / factor,
    }
  })
}
