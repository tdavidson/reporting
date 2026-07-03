'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLedgerFetch } from '@/components/accounting-vehicle'

/** Vehicle-scoped onboarding: seed chart, choose full-history or cutover, reconcile. */
export function AccountingSetup() {
  const [accountCount, setAccountCount] = useState<number | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [path, setPath] = useState<'full' | 'cutover' | null>(null)
  const [cutoverDate, setCutoverDate] = useState('')
  const [bootstrapping, setBootstrapping] = useState(false)
  const [bootstrapMsg, setBootstrapMsg] = useState<string | null>(null)
  const lf = useLedgerFetch()

  const refresh = useCallback(() =>
    lf('/api/accounting/chart')
      .then(r => (r.ok ? r.json() : []))
      .then(d => setAccountCount(Array.isArray(d) ? d.length : 0)), [lf])

  useEffect(() => { refresh() }, [refresh])

  async function seed() {
    setSeeding(true)
    await lf('/api/accounting/chart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    await refresh()
    setSeeding(false)
  }

  async function bootstrap() {
    if (!cutoverDate) return
    setBootstrapping(true); setBootstrapMsg(null)
    const res = await lf('/api/accounting/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entryDate: cutoverDate }) })
    const data = await res.json()
    setBootstrapMsg(res.ok ? `Booked opening balances for ${data.lpCount} LP(s).` : (data.error ?? 'Failed'))
    setBootstrapping(false)
  }

  if (accountCount === null) return null

  return (
    <div className="border rounded-lg p-4 mb-6 bg-muted/20 space-y-3">
      <p className="text-sm font-medium">Onboarding this vehicle</p>

      {/* Step 1 — chart */}
      <div className="flex items-center gap-2 text-sm">
        {accountCount > 0
          ? <><Check className="h-4 w-4 text-green-600" /> <span className="text-muted-foreground">Chart of accounts seeded ({accountCount} accounts).</span></>
          : <><span className="text-muted-foreground">1. Seed the chart of accounts.</span><Button size="sm" variant="outline" onClick={seed} disabled={seeding}>{seeding && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Seed chart</Button></>}
      </div>

      {/* Step 2 — choose path */}
      <div className="text-sm">
        <p className="text-muted-foreground mb-1.5">2. How are you starting this vehicle?</p>
        <div className="flex flex-wrap gap-1.5">
          {(['full', 'cutover'] as const).map(p => (
            <button key={p} onClick={() => setPath(p)}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${path === p ? 'border-foreground/30 bg-accent font-medium' : 'border-border text-muted-foreground hover:text-foreground'}`}>
              {p === 'full' ? 'Full history (reconstruct)' : 'Cutover opening balance'}
            </button>
          ))}
        </div>
      </div>

      {path === 'full' && (
        <ol className="text-sm text-muted-foreground space-y-1 list-decimal ml-4">
          <li><Link href="/accounting/bank" className="underline underline-offset-2 hover:text-foreground">Import the bank history</Link> (CSV/XLS) — dated cash back to inception.</li>
          <li>Categorize, and match inflows to capital calls / the investment purchase.</li>
          <li>Enter periodic <Link href="/accounting/allocations" className="underline underline-offset-2 hover:text-foreground">revaluations</Link> to walk NAV forward.</li>
          <li>Reconcile capital accounts against the LP snapshot (Reconciliation → Load from LP snapshot).</li>
        </ol>
      )}

      {path === 'cutover' && (
        <div className="text-sm space-y-2">
          <p className="text-muted-foreground">Generate opening balances from the LP data already in the platform (paid-in − distributions per LP), as of:</p>
          <div className="flex items-center gap-2">
            <input type="date" value={cutoverDate} onChange={e => setCutoverDate(e.target.value)} className="border rounded px-2 py-1.5 text-sm" />
            <Button size="sm" onClick={bootstrap} disabled={bootstrapping || !cutoverDate || accountCount === 0}>{bootstrapping && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Bootstrap opening balances</Button>
          </div>
          {bootstrapMsg && <p className="text-xs text-muted-foreground">{bootstrapMsg}</p>}
        </div>
      )}
    </div>
  )
}
