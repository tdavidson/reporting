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
  /**
   * Cost basis that arrived as INCOME rather than as capital the fund deployed — a staking
   * reward, an airdrop, a stock dividend, recognised at fair value on receipt.
   *
   * Kept out of `totalInvested` deliberately. It is real basis, so the schedule of investments
   * adds it to cost and a later sale nets against it rather than reporting the whole proceeds
   * as gain. But it is not a cheque the fund wrote, so folding it into invested capital would
   * understate every MOIC by treating a windfall as a contribution.
   */
  totalIncomeBasis: number
  totalShares: number
  totalRealized: number
  /** Income recognised on the position — cash and in kind — since inception. */
  totalIncome: number
  totalWrittenOff: number
  latestSharePrice: number | null
  unrealizedValue: number
  fmv: number
  moic: number | null
  grossIrr: number | null
  rounds: InvestmentRoundSummary[]
}
