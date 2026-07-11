'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'

interface Posting { id: string; account_id: string; amount: number; currency: string; lp_entity_id: string | null }
interface Entry {
  id: string
  entry_date: string
  memo: string | null
  source_type: string | null
  status: string
  journal_postings: Posting[]
}

export function JournalView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const lf = useLedgerFetch()

  useEffect(() => {
    setLoading(true)
    lf('/api/accounting/journal')
      .then(r => (r.ok ? r.json() : []))
      .then(d => setEntries(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false))
  }, [lf])

  if (loading) {
    return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
  }

  if (entries.length === 0) {
    return (
      <div className="border border-dashed rounded-lg p-8 text-center text-sm text-muted-foreground">
        No journal entries yet. Import opening balances to book the first entry.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {entries.map(e => (
        <div key={e.id} className="border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-muted/40 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-mono">{e.entry_date}</span>
              <span className="text-muted-foreground">{e.memo ?? e.source_type ?? 'Entry'}</span>
            </div>
            <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
              e.status === 'posted' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : e.status === 'void' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
            }`}>{e.status}</span>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {(e.journal_postings ?? []).map(p => {
                const amt = Number(p.amount)
                return (
                  <tr key={p.id} className="border-t">
                    <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{p.account_id.slice(0, 8)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{amt >= 0 ? fmt(amt) : ''}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{amt < 0 ? fmt(-amt) : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
