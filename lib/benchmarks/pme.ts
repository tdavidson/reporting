import type { CashFlow } from '@/lib/xirr'
import { xirr } from '@/lib/xirr'

// ---------------------------------------------------------------------------
// Public Market Equivalent (Direct Alpha method)
// Direct Alpha = IRR of synthetic cashflows using index values
//
// How it works:
// 1. Scale each capital call by the index level at call date (future-value to today)
// 2. Scale each distribution by the index level at dist date (future-value to today)
// 3. Add current NAV as final cash inflow
// 4. Compute IRR of the resulting flows — this IS the Direct Alpha
// ---------------------------------------------------------------------------

export interface IndexDataPoint {
  date: Date
  value: number // index level, e.g. IBOV = 125000
}

export interface PMEResult {
  directAlpha: number | null   // annualized excess return over index
  pmeRatio: number | null      // >1 = outperformed
  ksRatio: number | null       // Kaplan-Schoar PME
}

export function computePME(
  cashFlows: CashFlow[],   // negative = capital call, positive = distribution
  nav: number,
  navDate: Date,
  indexSeries: IndexDataPoint[]
): PMEResult {
  if (cashFlows.length === 0 || indexSeries.length === 0) {
    return { directAlpha: null, pmeRatio: null, ksRatio: null }
  }

  const latestIndex = indexSeries[indexSeries.length - 1].value

  function getIndexAt(date: Date): number {
    // find closest date in series
    let best = indexSeries[0]
    let bestDiff = Math.abs(date.getTime() - best.date.getTime())
    for (const pt of indexSeries) {
      const diff = Math.abs(date.getTime() - pt.date.getTime())
      if (diff < bestDiff) { best = pt; bestDiff = diff }
    }
    return best.value
  }

  // Kaplan-Schoar PME
  let fvCalls = 0
  let fvDists = 0
  for (const cf of cashFlows) {
    const idx = getIndexAt(cf.date)
    const fv = Math.abs(cf.amount) * (latestIndex / idx)
    if (cf.amount < 0) fvCalls += fv
    else fvDists += fv
  }
  const ksRatio = fvCalls > 0 ? (fvDists + nav) / fvCalls : null

  // Direct Alpha — IRR of index-adjusted flows
  const syntheticFlows: CashFlow[] = cashFlows.map(cf => ({
    date: cf.date,
    amount: cf.amount * (latestIndex / getIndexAt(cf.date)),
  }))
  syntheticFlows.push({ date: navDate, amount: nav })

  let directAlpha: number | null = null
  try {
    const hasNeg = syntheticFlows.some(f => f.amount < 0)
    const hasPos = syntheticFlows.some(f => f.amount > 0)
    if (hasNeg && hasPos) directAlpha = xirr(syntheticFlows)
  } catch {}

  const pmeRatio = ksRatio

  return { directAlpha, pmeRatio, ksRatio }
}
