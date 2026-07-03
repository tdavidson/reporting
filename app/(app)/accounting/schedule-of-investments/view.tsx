'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useCurrency, formatCurrencyFull } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'

interface SoiRow { name: string; cost: number; fairValue: number; pctOfNetAssets: number }
interface Soi { rows: SoiRow[]; totalCost: number; totalFairValue: number; netAssets: number }

export function ScheduleOfInvestmentsView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyFull(v, currency)
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`
  const [soi, setSoi] = useState<Soi | null>(null)
  const [loading, setLoading] = useState(true)
  const lf = useLedgerFetch()

  useEffect(() => {
    setLoading(true)
    lf('/api/accounting/statements')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setSoi(d?.scheduleOfInvestments ?? null))
      .finally(() => setLoading(false))
  }, [lf])

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
  if (!soi || soi.rows.length === 0) {
    return <div className="border border-dashed rounded-lg p-8 text-center text-sm text-muted-foreground">No investments booked yet. Record the investment purchase (Dr 1100 / Cr 1000) and revalue it.</div>
  }

  return (
    <div className="border rounded-lg overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left px-3 py-2 font-medium">Investment</th>
            <th className="text-right px-3 py-2 font-medium">Cost</th>
            <th className="text-right px-3 py-2 font-medium">Fair value</th>
            <th className="text-right px-3 py-2 font-medium">% of net assets</th>
          </tr>
        </thead>
        <tbody>
          {soi.rows.map((r, i) => (
            <tr key={i} className="border-b last:border-b-0">
              <td className="px-3 py-2">{r.name}</td>
              <td className="px-3 py-2 text-right font-mono">{fmt(r.cost)}</td>
              <td className="px-3 py-2 text-right font-mono">{fmt(r.fairValue)}</td>
              <td className="px-3 py-2 text-right font-mono text-muted-foreground">{pct(r.pctOfNetAssets)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t bg-muted/30 font-semibold">
            <td className="px-3 py-2">Total (net assets {fmt(soi.netAssets)})</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(soi.totalCost)}</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(soi.totalFairValue)}</td>
            <td className="px-3 py-2 text-right font-mono text-muted-foreground">{soi.netAssets ? pct(soi.totalFairValue / soi.netAssets) : '—'}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
