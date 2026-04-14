export interface InvestmentRoundSummary {
  roundName: string
  date: string | null
  investmentCost: number
  sharesAcquired: number
  sharePrice: number | null
  currentSharePrice: number | null
  currentValue: number
  interestConverted: number
  unrealizedValueChange: number
  costBasisExited: number
  totalRealized: number
  totalEscrow: number
  proceedsDate: string | null
  grossIrr: number | null
}

export interface CompanyInvestmentSummary {
  totalInvested: number
  totalShares: number
  totalRealized: number
  totalWrittenOff: number
  latestSharePrice: number | null
  unrealizedValue: number
  fmv: number
  moic: number | null
  grossIrr: number | null
  rounds: InvestmentRoundSummary[]
  entryValuation: number | null
}
