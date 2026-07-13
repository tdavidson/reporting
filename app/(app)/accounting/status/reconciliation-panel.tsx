'use client'

import { useEffect, useState } from 'react'
import { Loader2, Check, AlertTriangle } from 'lucide-react'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'
import { Button } from '@/components/ui/button'

interface LedgerRow { lpEntityId: string; name: string; ending: number }
interface ReconLine { lpEntityId: string; line: string; ledger: number; admin: number; delta: number; tiesOut: boolean }
interface ReconResult {
  lines: ReconLine[]
  reconciled: string[]
  ledgerOnly: string[]
  adminOnly: string[]
  allTieOut: boolean
  maxAbsDelta: number
  names: Record<string, string>
}

export function ReconciliationPanel() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [adminInput, setAdminInput] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ReconResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const lf = useLedgerFetch()

  useEffect(() => {
    setLoading(true)
    lf('/api/accounting/capital-accounts')
      .then(r => (r.ok ? r.json() : { rows: [] }))
      .then(d => setRows(d.rows ?? []))
      .finally(() => setLoading(false))
  }, [lf])

  async function loadSnapshot() {
    // Prefill the admin figures from the LP snapshot already in the platform.
    const res = await lf('/api/accounting/reconciliation')
    if (!res.ok) return
    const { snapshot } = await res.json()
    const next: Record<string, string> = {}
    for (const [id, fig] of Object.entries(snapshot ?? {})) {
      const f = fig as { contributions?: number; distributions?: number }
      const ending = (f.contributions ?? 0) + (f.distributions ?? 0)
      next[id] = String(ending)
    }
    setAdminInput(next)
  }

  async function runReconcile() {
    setRunning(true)
    const admin: Record<string, { ending: number }> = {}
    for (const [id, val] of Object.entries(adminInput)) {
      const n = parseFloat(val)
      if (!isNaN(n)) admin[id] = { ending: n }
    }
    const res = await lf('/api/accounting/reconciliation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin }),
    })
    if (res.ok) setResult(await res.json())
    setRunning(false)
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
  }

  if (rows.length === 0) {
    return (
      <div className="border border-dashed rounded-lg p-8 text-center text-sm text-muted-foreground">
        No ledger capital accounts to reconcile yet. Import opening balances and post a period first.
      </div>
    )
  }

  const deltaByEntity = new Map(result?.lines.filter(l => l.line === 'ending').map(l => [l.lpEntityId, l]) ?? [])

  return (
    <div className="space-y-4">
      {result && (
        <div className={`rounded-lg border p-3 flex items-center gap-2 text-sm ${
          result.allTieOut ? 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400'
                            : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
        }`}>
          {result.allTieOut ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {result.allTieOut
            ? 'Ties out — every LP matches the admin to the penny.'
            : `Does not tie out — largest difference ${fmt(result.maxAbsDelta)}.`}
          {(result.ledgerOnly.length > 0 || result.adminOnly.length > 0) && (
            <span className="text-muted-foreground">
              {result.ledgerOnly.length > 0 && ` ${result.ledgerOnly.length} ledger-only LP(s).`}
              {result.adminOnly.length > 0 && ` ${result.adminOnly.length} admin-only LP(s).`}
            </span>
          )}
        </div>
      )}

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-3 py-2 font-medium">LP</th>
              <th className="text-right px-3 py-2 font-medium">Ledger ending</th>
              <th className="text-right px-3 py-2 font-medium">Admin ending</th>
              <th className="text-right px-3 py-2 font-medium">Delta</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const d = deltaByEntity.get(r.lpEntityId)
              return (
                <tr key={r.lpEntityId} className="border-b last:border-b-0">
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(r.ending)}</td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      value={adminInput[r.lpEntityId] ?? ''}
                      onChange={e => setAdminInput(prev => ({ ...prev, [r.lpEntityId]: e.target.value }))}
                      placeholder="0.00"
                      className="border rounded px-1.5 py-0.5 text-sm text-right w-32 font-mono bg-transparent"
                    />
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${d && !d.tiesOut ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                    {d ? fmt(d.delta) : '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {d && (d.tiesOut ? <Check className="h-4 w-4 text-green-600 inline" /> : <AlertTriangle className="h-4 w-4 text-amber-500 inline" />)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={runReconcile} disabled={running}>
          {running && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Reconcile
        </Button>
        <Button variant="outline" onClick={loadSnapshot}>Load from LP snapshot</Button>
      </div>
    </div>
  )
}
