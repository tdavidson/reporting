export interface CashFlow {
  date: Date
  amount: number
}

export function xirr(flows: CashFlow[]): number | null {
  if (flows.length < 2) return null

  // Need at least one positive and one negative cash flow
  const hasPos = flows.some(f => f.amount > 0)
  const hasNeg = flows.some(f => f.amount < 0)
  if (!hasPos || !hasNeg) return null

  const daysFromFirst = flows.map(f => (f.date.getTime() - flows[0].date.getTime()) / (365.25 * 86400000))

  function npv(rate: number): number {
    return flows.reduce((sum, f, i) => sum + f.amount / Math.pow(1 + rate, daysFromFirst[i]), 0)
  }

  function dnpv(rate: number): number {
    return flows.reduce((sum, f, i) => {
      const t = daysFromFirst[i]
      return sum - t * f.amount / Math.pow(1 + rate, t + 1)
    }, 0)
  }

  // Try multiple starting guesses — a single guess can fail to converge
  // for very high or very low IRRs
  const guesses = [0.1, 0.5, -0.3, 1.0, 5.0, 10.0, 50.0, 100.0, 0.01]
  const totalAbsFlow = flows.reduce((s, f) => s + Math.abs(f.amount), 0)

  for (const guess of guesses) {
    let rate = guess
    let converged = false
    for (let iter = 0; iter < 200; iter++) {
      const val = npv(rate)
      const deriv = dnpv(rate)
      if (Math.abs(deriv) < 1e-12) break
      const next = rate - val / deriv
      if (Math.abs(next - rate) < 1e-8) {
        rate = next
        converged = true
        break
      }
      rate = next
      if (rate < -0.999 || rate > 1e6) break
    }
    if (converged || Math.abs(npv(rate)) < Math.max(1, totalAbsFlow * 1e-6)) {
      return rate
    }
  }
  return null
}
