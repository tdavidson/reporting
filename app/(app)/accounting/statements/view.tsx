'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useCurrency, formatCurrencyFull } from '@/components/currency-context'

interface Section { label: string; rows: { code: string; name: string; amount: number }[]; total: number }
interface Data {
  trialBalance: { rows: { code: string; name: string; debit: number; credit: number }[]; totalDebits: number; totalCredits: number; balanced: boolean }
  balanceSheet: { assets: Section; liabilities: Section; equity: Section; check: number }
  incomeStatement: { income: Section; expenses: Section; netIncome: number }
}

export function StatementsView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyFull(v, currency)
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/accounting/statements')
      .then(r => (r.ok ? r.json() : null))
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
  }
  if (!data || data.trialBalance.rows.length === 0) {
    return (
      <div className="border border-dashed rounded-lg p-8 text-center text-sm text-muted-foreground">
        No statements yet — the ledger has no posted entries.
      </div>
    )
  }

  const Sec = ({ s }: { s: Section }) => (
    <>
      <tr className="border-t bg-muted/30"><td className="px-3 py-1.5 font-medium" colSpan={2}>{s.label}</td></tr>
      {s.rows.map(r => (
        <tr key={r.code} className="border-t">
          <td className="px-3 py-1.5 text-muted-foreground">{r.code} · {r.name}</td>
          <td className="px-3 py-1.5 text-right font-mono">{fmt(r.amount)}</td>
        </tr>
      ))}
      <tr className="border-t font-semibold"><td className="px-3 py-1.5">Total {s.label}</td><td className="px-3 py-1.5 text-right font-mono">{fmt(s.total)}</td></tr>
    </>
  )

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h2 className="text-sm font-semibold mb-2">Balance sheet</h2>
        <table className="w-full text-sm border rounded-lg overflow-hidden">
          <tbody>
            <Sec s={data.balanceSheet.assets} />
            <Sec s={data.balanceSheet.liabilities} />
            <Sec s={data.balanceSheet.equity} />
          </tbody>
        </table>
        {data.balanceSheet.check !== 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            Residual {fmt(data.balanceSheet.check)} (net income not yet closed to capital).
          </p>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-2">Income statement</h2>
        <table className="w-full text-sm border rounded-lg overflow-hidden">
          <tbody>
            <Sec s={data.incomeStatement.income} />
            <Sec s={data.incomeStatement.expenses} />
            <tr className="border-t font-semibold bg-muted/30">
              <td className="px-3 py-1.5">Net income</td>
              <td className="px-3 py-1.5 text-right font-mono">{fmt(data.incomeStatement.netIncome)}</td>
            </tr>
          </tbody>
        </table>

        <h2 className="text-sm font-semibold mb-2 mt-4">Trial balance</h2>
        <p className="text-xs text-muted-foreground mb-1">
          {data.trialBalance.balanced ? 'Balanced — debits equal credits.' : 'Out of balance.'}
        </p>
      </div>
    </div>
  )
}
