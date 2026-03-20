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

  for (const txn of transactions) {
    if (txn.transaction_type === 'investment') {
      totalInvested += txn.investment_cost ?? 0
      totalShares += txn.shares_acquired ?? 0

      if (txn.transaction_date && txn.investment_cost) {
        const cf = { date: new Date(txn.transaction_date), amount: -(txn.investment_cost) }
        cashFlows.push(cf)
        const rn = txn.round_name ?? 'Unknown'
        if (!roundCashFlows.has(rn)) roundCashFlows.set(rn, [])
        roundCashFlows.get(rn)!.push({ ...cf })
      }

      const roundName = txn.round_name ?? 'Unknown'
      const existing = roundMap.get(roundName)
      if (existing) {
        existing.investmentCost += txn.investment_cost ?? 0
        existing.sharesAcquired += txn.shares_acquired ?? 0
        existing.interestConverted += txn.interest_converted ?? 0
        if (!existing.date && txn.transaction_date) existing.date = txn.transaction_date
        if (txn.share_price != null && txn.share_price > 0) existing.sharePrice = txn.share_price
      } else {
        roundMap.set(roundName, {
          roundName,
          date: txn.transaction_date,
          investmentCost: txn.investment_cost ?? 0,
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

// Extract latest ownership_pct and post_money from unrealized_gain_change transactions
  let latestOwnershipPct: number | null = null
  let latestPostMoney: number | null = null
  let latestValuationDate: string | null = null

  for (const txn of transactions) {
    if (txn.transaction_type === 'unrealized_gain_change') {
      if (txn.transaction_date && (!latestValuationDate || txn.transaction_date >= latestValuationDate)) {
        if (txn.ownership_pct != null) latestOwnershipPct = txn.ownership_pct
        if (txn.latest_postmoney_valuation != null) latestPostMoney = txn.latest_postmoney_valuation
        latestValuationDate = txn.transaction_date
      }
    }
  }

  // Compute per-round FMV and sum for company unrealized value
  const rounds = Array.from(roundMap.values())
  let unrealizedValue = 0

  if (latestOwnershipPct != null && latestPostMoney != null) {
    // Use fully diluted ownership × post-money valuation
    unrealizedValue = (latestOwnershipPct / 100) * latestPostMoney
    for (const round of rounds) {
      round.currentSharePrice = null
      round.currentValue = unrealizedValue / rounds.length
    }
  } else {
    for (const round of rounds) {
      const effectiveSharePrice = latestSharePrice ?? round.sharePrice ?? null
      round.currentSharePrice = effectiveSharePrice
      const isPricedEquity = round.sharesAcquired > 0 && ((round.sharePrice != null && round.sharePrice > 0) || round.investmentCost > 0)
      const remainingBasis = round.investmentCost - round.costBasisExited
      if (remainingBasis <= 0) {
        round.currentValue = 0
      } else if (isPricedEquity) {
        const fraction = round.investmentCost > 0 ? remainingBasis / round.investmentCost : 0
        round.currentValue = effectiveSharePrice != null ? round.sharesAcquired * fraction * effectiveSharePrice : 0
      } else {
        round.currentValue = Math.max(0, remainingBasis + round.unrealizedValueChange)
      }
      unrealizedValue += round.currentValue
    }
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
