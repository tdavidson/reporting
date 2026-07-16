'use client'

// Deal-by-deal (American) carry — a REFERENCE calculator, not a posting surface. It computes the
// GP's per-deal carry entitlement (each deal's gain over its fully-loaded cost) for an American
// vehicle. The close still ACCRUES the whole-fund figure (= European, which the clawback makes the
// same total); actual carry distributions arrive as real cash flows, computed outside the app.
// This lives on Admin as a planning/what-if view — it does not drive the financial statements.

import { useCallback, useEffect, useState } from 'react'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'

interface DealCarry {
  companyId: string
  name: string
  costBasis: number
  proceeds: number
  remainingValue: number
  allocatedExpense: number
  fullyLoadedCost: number
  profit: number
  carry: number
}
interface Resp {
  group: string
  kind: string
  carryRate: number
  deals: DealCarry[]
  totalCarry: number
  totalExpenses: number
}

export function DealCarryCard() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const lf = useLedgerFetch()
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    lf('/api/accounting/deal-carry')
      .then(r => (r.ok ? r.json() : null))
      .then(setData)
      .finally(() => setLoading(false))
  }, [lf])
  useEffect(() => { load() }, [load])

  // Silent unless this vehicle is American with deals — it's not relevant elsewhere.
  if (loading || !data || data.kind !== 'american' || data.deals.length === 0) return null

  const pct = (v: number) => `${Math.round(v * 10000) / 100}%`

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-sm font-medium">Deal-by-deal carry (American)</p>
        <span className="text-xs text-muted-foreground">{pct(data.carryRate)} carry</span>
      </div>
      <p className="text-xs text-muted-foreground mb-2 max-w-3xl">
        A reference calculation: carry on each deal&rsquo;s gain over its <strong>fully-loaded cost</strong>
        {' '}(cost basis plus its share of fund expenses). The close still accrues the whole-fund figure;
        this is for sizing what a deal-by-deal distribution would be. It does not post anything.
      </p>
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="text-xs text-muted-foreground bg-muted/40">
            <tr>
              <th className="text-left px-3 py-1.5 font-medium">Deal</th>
              <th className="text-right px-3 py-1.5 font-medium">Cost basis</th>
              <th className="text-right px-3 py-1.5 font-medium">Alloc. expense</th>
              <th className="text-right px-3 py-1.5 font-medium">Proceeds</th>
              <th className="text-right px-3 py-1.5 font-medium">Remaining value</th>
              <th className="text-right px-3 py-1.5 font-medium">Gain</th>
              <th className="text-right px-3 py-1.5 font-medium">Carry</th>
            </tr>
          </thead>
          <tbody>
            {data.deals.map(d => (
              <tr key={d.companyId} className="border-t">
                <td className="px-3 py-1.5">{d.name}</td>
                <td className="px-3 py-1.5 text-right font-mono">{fmt(d.costBasis)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{fmt(d.allocatedExpense)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{fmt(d.proceeds)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{fmt(d.remainingValue)}</td>
                <td className={`px-3 py-1.5 text-right font-mono ${d.profit < 0 ? 'text-muted-foreground' : ''}`}>{fmt(d.profit)}</td>
                <td className="px-3 py-1.5 text-right font-mono font-medium">{fmt(d.carry)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/30 font-semibold">
              <td className="px-3 py-1.5" colSpan={6}>Total carry earned deal-by-deal</td>
              <td className="px-3 py-1.5 text-right font-mono">{fmt(data.totalCarry)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
