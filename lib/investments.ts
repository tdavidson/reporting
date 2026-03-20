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

  const roundMap = new Map<string, InvestmentRoundSummary & {
    ownershipPct: number | null
    postMoneyValuation: number | null
    latestOwnershipPct: number | null
    latestPostMoneyValuation: number | null
    latestValuationDate: string | null
  }>()
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
          ownershipPct: txn.ownership_pct ?? null,
          postMoneyValuation: txn.postmoney_valuation ?? null,
          latestOwnershipPct: null,
          latestPostMoneyValuation: null,
          latestValuationDate: null,
        })
      }

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
      if (txn.round_name) {
        const round = roundMap.get(txn.round_name)
        if (round) {
          if (txn.unrealized_value_change != null) round.unrealizedValueChange += txn.unrealized_value_change
          if (txn.transaction_date) {
            if (!round.latestValuationDate || txn.transaction_date >= round.latestValuationDate) {
              if (txn.ownership_pct != null) round.latestOwnershipPct = txn.ownership_pct
              if (txn.latest_postmoney_valuation != null) round.latestPostMoneyValuation = txn.latest_postmoney_valuation
              round.latestValuationDate = txn.transaction_date
            }
          }
        }
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

  // Compute per-round NAV using ownership × post-money per round
  const rounds = Array.from(roundMap.values())
  for (const round of rounds) {
    round.currentSharePrice = null
    const ownershipPct = round.latestOwnershipPct ?? round.ownershipPct ?? null
    const postMoney = round.latestPostMoneyValuation ?? round.postMoneyValuation ?? null
    if (ownershipPct != null && postMoney != null) {
      round.currentValue = (ownershipPct / 100) * postMoney
    } else {
      const remainingBasis = round.investmentCost - round.costBasisExited
      round.currentValue = remainingBasis <= 0 ? 0 : Math.max(0, remainingBasis + round.unrealizedValueChange)
    }
  }

  // NAV = most recent round's value
  let unrealizedValue = 0
  if (rounds.length > 0) {
    const sortedRounds = [...rounds].sort((a, b) => {
      const aDate = a.latestValuationDate ?? a.date ?? ''
      const bDate = b.latestValuationDate ?? b.date ?? ''
      return bDate.localeCompare(aDate)
    })
    unrealizedValue = sortedRounds[0].currentValue
  }

  // Compute per-round IRR
  for (const round of rounds) {
    const rcf = roundCashFlows.get(round.roundName) ?? []
    const hasInvestment = rcf.some(cf => cf.amount < 0)
    const hasProceeds = rcf.some(cf => cf.amount > 0)

    if (hasInvestment && hasProceeds) {
      round.grossIrr = xirr(rcf)
    } else if (hasInvestment && !hasProceeds) {
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
