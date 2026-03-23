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
  // 1. ORDENAÇÃO CRONOLÓGICA (Essencial para a lógica de Snapshot)
  const sortedTxns = [...transactions].sort((a, b) => 
    (a.transaction_date || '').localeCompare(b.transaction_date || '')
  )

  let totalInvested = 0
  let totalShares = 0
  let totalRealized = 0
  let totalWrittenOff = 0
  let latestSharePrice: number | null = null
  let latestSharePriceDate: string | null = null

  // Variáveis para rastrear o "Estado Atual" (Snapshot)
  let currentOwnership: number | null = null
  let currentValuation: number | null = null
  let explicitNav: number | null = null
  
  const cashFlows: CashFlow[] = []
  const roundMap = new Map<string, InvestmentRoundSummary>()

  for (const txn of sortedTxns) {
    const txnDate = txn.transaction_date ? new Date(txn.transaction_date + 'T12:00:00') : null
    if (!txnDate || txnDate > asOfDate) continue

    const roundName = txn.round_name ?? 'Unknown'

    // --- TRATAMENTO POR TIPO DE TRANSAÇÃO ---

   if (txn.transaction_type === 'investment') {
      totalInvested += txn.investment_cost ?? 0
      totalShares += (txn.shares_acquired ?? 0)
      if (txn.investment_cost) {
        cashFlows.push({ date: txnDate, amount: -(txn.investment_cost) })
      }
    }

    if (txn.transaction_type === 'proceeds') {
      const proceedsAmount = (txn.proceeds_received ?? 0) + (txn.proceeds_escrow ?? 0)
      totalRealized += proceedsAmount
      totalWrittenOff += txn.proceeds_written_off ?? 0
      if (proceedsAmount > 0) {
        cashFlows.push({ date: txnDate, amount: proceedsAmount })
      }
    }

    if (txn.ownership_pct != null) currentOwnership = txn.ownership_pct
    
    let val = txn.postmoney_valuation
    if (txn.transaction_type === 'unrealized_gain_change') val = txn.latest_postmoney_valuation
    if (txn.transaction_type === 'proceeds' && txn.exit_valuation != null) val = txn.exit_valuation
    
    if (val != null) currentValuation = val

    if (txn.transaction_type === 'unrealized_gain_change' && txn.unrealized_value_change != null) {
      explicitNav = txn.unrealized_value_change
    } else if (txn.transaction_type === 'proceeds') {
      explicitNav = txn.unrealized_value_change ?? explicitNav
    } else {
      explicitNav = null
    }

    const sPrice = txn.transaction_type === 'unrealized_gain_change' ? txn.current_share_price : txn.share_price
    if (sPrice != null && sPrice > 0) {
      if (!latestSharePriceDate || txn.transaction_date! >= latestSharePriceDate) {
        latestSharePrice = sPrice
        latestSharePriceDate = txn.transaction_date!
      }
    }

  // 2. CÁLCULO DO NAV (TERMINAL VALUE)
  let unrealizedValue = 0
  if (explicitNav != null) {
    unrealizedValue = explicitNav
  } else if (currentOwnership != null && currentValuation != null) {
    // Lógica: Snapshot da participação % sobre o último Valuation conhecido
    unrealizedValue = (currentOwnership / 100) * currentValuation
  }

  // 3. CÁLCULO DO GROSS IRR (XIRR)
  let grossIrr: number | null = null
  if (cashFlows.length > 0) {
    const finalFlows = [...cashFlows]
    
    // Se a empresa não foi encerrada, simulamos a entrada do NAV hoje (Valor Terminal)
    if (companyStatus !== 'exited' && unrealizedValue > 0) {
      finalFlows.push({ date: asOfDate, amount: unrealizedValue })
    }

    // O XIRR exige pelo menos um fluxo negativo e um positivo
    const hasNeg = finalFlows.some(f => f.amount < 0)
    const hasPos = finalFlows.some(f => f.amount > 0)
    
    if (hasNeg && hasPos) {
      try {
        grossIrr = xirr(finalFlows)
      } catch (e) {
        console.error("XIRR Calculation Error:", e)
        grossIrr = null
      }
    }
  }

  // 4. MÚLTIPLO (MOIC)
  const moic = totalInvested > 0 ? (totalRealized + unrealizedValue) / totalInvested : null

  return {
    totalInvested,
    totalShares,
    totalRealized,
    totalWrittenOff,
    latestSharePrice,
    unrealizedValue,
    fmv: companyStatus === 'exited' ? totalRealized : unrealizedValue,
    moic,
    grossIrr,
    rounds: [], // Pode ser populado se houver necessidade de quebra por round na UI
  }
}
