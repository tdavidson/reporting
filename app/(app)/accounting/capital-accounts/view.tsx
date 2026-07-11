'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'

interface Row {
  lpEntityId: string
  name: string
  beginning: number
  contributions: number
  distributions: number
  managementFees: number
  expenses: number
  gains: number
  other: number
  ending: number
}

const COLUMNS: { key: keyof Row; label: string }[] = [
  { key: 'beginning', label: 'Beginning' },
  { key: 'contributions', label: 'Contributions' },
  { key: 'distributions', label: 'Distributions' },
  { key: 'managementFees', label: 'Mgmt fees' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'gains', label: 'Gains' },
  { key: 'ending', label: 'Ending' },
]

export function CapitalAccountsView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const [rows, setRows] = useState<Row[]>([])
  const [nav, setNav] = useState(0)
  const [loading, setLoading] = useState(true)
  const lf = useLedgerFetch()

  useEffect(() => {
    setLoading(true)
    lf('/api/accounting/capital-accounts')
      .then(r => (r.ok ? r.json() : { rows: [], nav: 0 }))
      .then(d => { setRows(d.rows ?? []); setNav(d.nav ?? 0) })
      .finally(() => setLoading(false))
  }, [lf])

  if (loading) {
    return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
  }

  if (rows.length === 0) {
    return (
      <div className="border border-dashed rounded-lg p-8 text-center text-sm text-muted-foreground">
        No capital accounts yet. Seed the chart of accounts and import opening balances from the
        Accounting home page, then post a period of activity.
      </div>
    )
  }

  const totals = COLUMNS.reduce((acc, c) => {
    acc[c.key] = rows.reduce((s, r) => s + (r[c.key] as number), 0)
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="border rounded-lg overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left px-3 py-2 font-medium">LP</th>
            {COLUMNS.map(c => <th key={c.key} className="text-right px-3 py-2 font-medium">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.lpEntityId} className="border-b last:border-b-0 hover:bg-muted/30">
              <td className="px-3 py-2">
                <Link href={`/accounting/capital-accounts/${r.lpEntityId}`} className="hover:underline">{r.name}</Link>
              </td>
              {COLUMNS.map(c => (
                <td key={c.key} className={`px-3 py-2 text-right font-mono ${c.key === 'ending' ? 'font-semibold' : ''}`}>
                  {fmt(r[c.key] as number)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t bg-muted/30 font-semibold">
            <td className="px-3 py-2">Total (NAV {fmt(nav)})</td>
            {COLUMNS.map(c => <td key={c.key} className="px-3 py-2 text-right font-mono">{fmt(totals[c.key])}</td>)}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
