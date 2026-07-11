'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'

interface Row { lpEntityId: string; name: string; commitment: number; called: number; funded: number; outstanding: number; receivable: number; ending: number }
interface RollForward { beginning: number; contributions: number; distributions: number; managementFees: number; expenses: number; gains: number; other: number; ending: number }
interface Txn { date: string; memo: string | null; sourceType: string | null; amount: number; balance: number }
interface Statement { row: Row; rollForward: RollForward; transactions: Txn[] }

const ROLL: { key: keyof RollForward; label: string }[] = [
  { key: 'beginning', label: 'Beginning capital' },
  { key: 'contributions', label: 'Contributions (called)' },
  { key: 'distributions', label: 'Distributions' },
  { key: 'managementFees', label: 'Management fees' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'gains', label: 'Gains / (losses)' },
  { key: 'other', label: 'Other' },
  { key: 'ending', label: 'Ending capital (NAV)' },
]

export function LpStatementView({ lpEntityId }: { lpEntityId: string }) {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const lf = useLedgerFetch()
  const [data, setData] = useState<Statement | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    lf(`/api/accounting/lp-statement?lp=${encodeURIComponent(lpEntityId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => setData(d && !d.error ? d : null))
      .finally(() => setLoading(false))
  }, [lf, lpEntityId])

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
  if (!data) return <div className="border border-dashed rounded-lg p-8 text-center text-sm text-muted-foreground">No statement for this LP in the selected vehicle.</div>

  const { row, rollForward, transactions } = data
  const cards: { label: string; value: number }[] = [
    { label: 'Commitment', value: row.commitment },
    { label: 'Called', value: row.called },
    { label: 'Funded', value: row.funded },
    { label: 'Outstanding', value: row.outstanding },
    { label: 'Unfunded call', value: row.receivable },
    { label: 'Ending NAV', value: row.ending },
  ]

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium">{row.name}</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {cards.map(c => (
          <div key={c.label} className="border rounded-lg p-3">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className="text-lg font-mono font-semibold mt-0.5">{fmt(c.value)}</p>
          </div>
        ))}
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Capital roll-forward</p>
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {ROLL.map(r => (
                <tr key={r.key} className={`border-b last:border-b-0 ${r.key === 'ending' ? 'font-semibold bg-muted/30' : ''}`}>
                  <td className="px-3 py-2">{r.label}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(rollForward[r.key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Transactions</p>
        {transactions.length === 0 ? (
          <div className="border border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground">No capital movements yet.</div>
        ) : (
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-3 py-2 font-medium">Date</th>
                  <th className="text-left px-3 py-2 font-medium">Description</th>
                  <th className="text-left px-3 py-2 font-medium">Type</th>
                  <th className="text-right px-3 py-2 font-medium">Amount</th>
                  <th className="text-right px-3 py-2 font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t, i) => (
                  <tr key={i} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{t.date}</td>
                    <td className="px-3 py-2">{t.memo ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{t.sourceType ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(t.amount)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(t.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
