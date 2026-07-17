import type { InvestmentTransaction, CompanyStatus } from '@/lib/types/database'
import type { CompanyInvestmentSummary, InvestmentRoundSummary } from '@/lib/types/investments'
import { xirr, type CashFlow } from '@/lib/xirr'

// ---------------------------------------------------------------------------
// Compute summary from raw transactions
// ---------------------------------------------------------------------------

export function computeSummary(
  transactions: InvestmentTransaction[],
  companyStatus: CompanyStatus,
  asOfDate: Date = new Date()
): CompanyInvestmentSummary {
  let totalInvested = 0
  let totalShares = 0
  let totalRealized = 0
  let totalWrittenOff = 0
  let latestSharePrice: number | null = null
  let latestSharePriceDate: string | null = null

  const roundMap = new Map<string, InvestmentRoundSummary>()
  const roundCashFlows = new Map<string, CashFlow[]>()
  const cashFlows: CashFlow[] = []

  // A conversion (a SAFE/note investment row carrying `converts_from_txn_id`) MOVES the source
  // instrument's basis into the priced round it became. When source and target are different
  // rounds we shift the basis for fair-value purposes: it leaves the source round (so the SAFE
  // stops showing a live position) and lands in the target round (so its priced-equity value is
  // computed on the full basis). The source row's cash outflow stays on its own date for IRR —
  // only the FV attribution moves. Same-round conversions need no shift: the basis is already
  // there; the conversion just makes the round priced.
  const byId = new Map<string, InvestmentTransaction>()
  for (const t of transactions) if (t.id) byId.set(t.id, t)
  const carriedInByRound = new Map<string, number>()   // basis moved INTO a round from a conversion
  const carriedOutByRound = new Map<string, number>()  // basis moved OUT of a source round
  for (const t of transactions) {
    const srcId = (t as { converts_from_txn_id?: string | null }).converts_from_txn_id
    if (t.transaction_type !== 'investment' || !srcId) continue
    const src = byId.get(srcId)
    if (!src || src.transaction_type !== 'investment') continue
    const targetRound = t.round_name ?? 'Unknown'
    const sourceRound = src.round_name ?? 'Unknown'
    if (targetRound === sourceRound) continue // nothing to move
    const carried = src.investment_cost ?? 0
    carriedInByRound.set(targetRound, (carriedInByRound.get(targetRound) ?? 0) + carried)
    carriedOutByRound.set(sourceRound, (carriedOutByRound.get(sourceRound) ?? 0) + carried)
  }

  for (const txn of transactions) {
    if (txn.transaction_type === 'investment') {
      const isConversion = !!(txn as { converts_from_txn_id?: string | null }).converts_from_txn_id
      totalInvested += txn.investment_cost ?? 0
      totalShares += txn.shares_acquired ?? 0
      // Interest that rolled into equity at conversion is real cost basis (it was recognized as
      // income while accruing, and now capitalizes into the position). It is NOT cash, so it is
      // added to basis here but never pushed as a cash flow. Only counted on the conversion row.
      if (isConversion) totalInvested += txn.interest_converted ?? 0

      if (txn.transaction_date && txn.investment_cost) {
        const cf = { date: new Date(txn.transaction_date), amount: -(txn.investment_cost) }
        cashFlows.push(cf)
        const rn = txn.round_name ?? 'Unknown'
        if (!roundCashFlows.has(rn)) roundCashFlows.set(rn, [])
        roundCashFlows.get(rn)!.push({ ...cf })
      }

      // On a conversion row, interest_converted capitalizes into the round's basis alongside any
      // new cash; on an ordinary row it is tracked separately (interestConverted) but not as cost.
      const rowBasis = (txn.investment_cost ?? 0) + (isConversion ? (txn.interest_converted ?? 0) : 0)
      const roundName = txn.round_name ?? 'Unknown'
      const existing = roundMap.get(roundName)
      if (existing) {
        existing.investmentCost += rowBasis
        existing.sharesAcquired += txn.shares_acquired ?? 0
        existing.interestConverted += txn.interest_converted ?? 0
        if (!existing.date && txn.transaction_date) existing.date = txn.transaction_date
        if (txn.share_price != null && txn.share_price > 0) existing.sharePrice = txn.share_price
      } else {
        roundMap.set(roundName, {
          roundName,
          date: txn.transaction_date,
          investmentCost: rowBasis,
          sharesAcquired: txn.shares_acquired ?? 0,
          sharePrice: (txn.share_price != null && txn.share_price > 0) ? txn.share_price : null,
          currentSharePrice: null,
          currentValue: 0,
          interestConverted: txn.interest_converted ?? 0,
          unrealizedValueChange: 0,
          costBasisExited: 0,
          totalRealized: 0,
          totalEscrow: 0,
          proceedsDate: null,
          grossIrr: null,
        })
      }
      // Also track share price for latest determination
      // Only use positive share prices (skip $0 from SAFEs, warrants, etc.)
      if (txn.share_price != null && txn.share_price > 0 && txn.transaction_date) {
        if (!latestSharePriceDate || txn.transaction_date > latestSharePriceDate) {
          latestSharePrice = txn.share_price
          latestSharePriceDate = txn.transaction_date
        }
      }
    }

    if (txn.transaction_type === 'proceeds') {
      const proceedsAmount = (txn.proceeds_received ?? 0) + (txn.proceeds_escrow ?? 0)
      totalRealized += proceedsAmount
      totalWrittenOff += txn.proceeds_written_off ?? 0

      if (txn.transaction_date && proceedsAmount > 0) {
        const cf = { date: new Date(txn.transaction_date), amount: proceedsAmount }
        cashFlows.push(cf)
        if (txn.round_name) {
          if (!roundCashFlows.has(txn.round_name)) roundCashFlows.set(txn.round_name, [])
          roundCashFlows.get(txn.round_name)!.push({ ...cf })
        }
      }
      // Attribute cost basis exited and proceeds to the round if specified
      if (txn.round_name) {
        const round = roundMap.get(txn.round_name)
        if (round) {
          if (txn.cost_basis_exited != null) round.costBasisExited += Math.abs(txn.cost_basis_exited)
          round.totalRealized += txn.proceeds_received ?? 0
          round.totalEscrow += txn.proceeds_escrow ?? 0
          if (txn.transaction_date) {
            if (!round.proceedsDate || txn.transaction_date > round.proceedsDate) {
              round.proceedsDate = txn.transaction_date
            }
          }
        }
      }
    }

    if (txn.transaction_type === 'unrealized_gain_change') {
      if (txn.current_share_price != null && txn.transaction_date) {
        if (!latestSharePriceDate || txn.transaction_date >= latestSharePriceDate) {
          latestSharePrice = txn.current_share_price
          latestSharePriceDate = txn.transaction_date
        }
      }
      // Attribute unrealized value change to the round if specified
      if (txn.round_name && txn.unrealized_value_change != null) {
        const round = roundMap.get(txn.round_name)
        if (round) round.unrealizedValueChange += txn.unrealized_value_change
      }
    }

    if (txn.transaction_type === 'round_info') {
      if (txn.share_price != null && txn.transaction_date) {
        if (!latestSharePriceDate || txn.transaction_date >= latestSharePriceDate) {
          latestSharePrice = txn.share_price
          latestSharePriceDate = txn.transaction_date
        }
      }
    }
  }

  // Compute per-round FMV and sum for company unrealized value
  const rounds = Array.from(roundMap.values())
  let unrealizedValue = 0
  for (const round of rounds) {
    // Use the latest share price from unrealized_gain_change / round_info transactions.
    // If none exists, fall back to the round's own share price from the investment.
    const effectiveSharePrice = latestSharePrice ?? round.sharePrice ?? null
    round.currentSharePrice = effectiveSharePrice
    // Conversions move basis between rounds: a target round is valued on its own basis PLUS what
    // converted into it; a source round has the converted basis removed (so a SAFE that has fully
    // converted shows no live position). Both default to 0 when there are no conversions.
    const carriedIn = carriedInByRound.get(round.roundName) ?? 0
    const carriedOut = carriedOutByRound.get(round.roundName) ?? 0
    const roundBasis = round.investmentCost + carriedIn
    const isPricedEquity = round.sharesAcquired > 0 && ((round.sharePrice != null && round.sharePrice > 0) || roundBasis > 0)
    // If all cost basis has been exited (or converted away), there's no remaining unrealized position
    const remainingBasis = roundBasis - round.costBasisExited - carriedOut
    if (remainingBasis <= 0) {
      round.currentValue = 0
    } else if (isPricedEquity) {
      // Equity round: prorate shares by remaining basis fraction
      const fraction = roundBasis > 0 ? remainingBasis / roundBasis : 0
      round.currentValue = effectiveSharePrice != null ? round.sharesAcquired * fraction * effectiveSharePrice : 0
    } else {
      // Convertible / warrant / no shares: remaining basis + unrealized changes
      round.currentValue = Math.max(0, remainingBasis + round.unrealizedValueChange)
    }
    unrealizedValue += round.currentValue
  }

  // Compute per-round IRR
  for (const round of rounds) {
    const rcf = roundCashFlows.get(round.roundName) ?? []
    const hasInvestment = rcf.some(cf => cf.amount < 0)
    const hasProceeds = rcf.some(cf => cf.amount > 0)

    if (hasInvestment && hasProceeds) {
      // Full cash flow data available
      round.grossIrr = xirr(rcf)
    } else if (hasInvestment && !hasProceeds) {
      // Investment cash flows exist but proceeds aren't attributed to this round yet.
      // Fall back to round-level totals if we have proceeds date + amounts.
      const totalRoundProceeds = round.totalRealized + round.totalEscrow
      if (totalRoundProceeds > 0 && round.proceedsDate) {
        round.grossIrr = xirr([...rcf, { date: new Date(round.proceedsDate), amount: totalRoundProceeds }])
      } else if (companyStatus !== 'exited' && round.currentValue > 0) {
        round.grossIrr = xirr([...rcf, { date: asOfDate, amount: round.currentValue }])
      }
    }
  }

  let fmv: number
  if (companyStatus === 'exited') {
    fmv = totalRealized
  } else if (companyStatus === 'written-off') {
    fmv = 0
  } else {
    fmv = unrealizedValue
  }

  const moic = totalInvested > 0 ? (totalRealized + unrealizedValue) / totalInvested : null

  // Compute gross IRR
  let grossIrr: number | null = null
  if (cashFlows.length > 0) {
    const terminalValue = companyStatus === 'written-off' ? 0 : unrealizedValue
    if (terminalValue > 0 || totalRealized > 0) {
      if (companyStatus !== 'exited' && terminalValue > 0) {
        cashFlows.push({ date: asOfDate, amount: terminalValue })
      }
      grossIrr = xirr(cashFlows)
    }
  }

  return {
    totalInvested,
    totalShares,
    totalRealized,
    totalWrittenOff,
    latestSharePrice,
    unrealizedValue,
    fmv,
    moic,
    grossIrr,
    rounds,
  }
}
