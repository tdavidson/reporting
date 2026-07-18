'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLedgerFetch, useFundSeg } from '@/components/accounting-vehicle'

/** Vehicle-scoped onboarding: seed chart, choose full-history or cutover, reconcile. */
export function AccountingSetup({ alwaysShow = false }: { alwaysShow?: boolean } = {}) {
  const [accountCount, setAccountCount] = useState<number | null>(null)
  const [onboarded, setOnboarded] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [seedMsg, setSeedMsg] = useState<string | null>(null)
  // Persisted per vehicle — this used to be local state, so the choice was lost on
  // every refresh and nothing downstream (like opening balances) could act on it.
  const [path, setPath] = useState<'full_history' | 'cutover' | null>(null)
  const [cutoverDate, setCutoverDate] = useState('')
  const [bootstrapping, setBootstrapping] = useState(false)
  const [bootstrapMsg, setBootstrapMsg] = useState<string | null>(null)
  // A vehicle could finish every step here and still carry no investments — the tracker
  // knew about them and the ledger didn't. That's a setup step, so it belongs on this card.
  const [inv, setInv] = useState<{ booked: boolean; positions: number } | null>(null)
  const lf = useLedgerFetch()
  const fundSeg = useFundSeg()
  const fundHref = (sub: string) => fundSeg ? `/funds/${fundSeg}/${sub}` : '/funds'

  const refresh = useCallback(async () => {
    const [chart, status] = await Promise.all([
      lf('/api/accounting/chart').then(r => (r.ok ? r.json() : [])),
      lf('/api/accounting/status').then(r => (r.ok ? r.json() : null)),
    ])
    setAccountCount(Array.isArray(chart) ? chart.length : 0)
    setPath(status?.setup?.historyMode ?? null)
    setOnboarded(!!status?.onboarded)
    setInv(status
      ? { booked: !!status.setup?.investmentsBooked, positions: status.investments?.trackerPositions ?? 0 }
      : null)
  }, [lf])

  useEffect(() => { refresh() }, [refresh])

  async function choosePath(mode: 'full_history' | 'cutover') {
    setPath(mode)
    await lf('/api/accounting/allocation-terms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'historyMode', historyMode: mode }),
    })
  }

  async function seed() {
    setSeeding(true); setSeedMsg(null)
    const res = await lf('/api/accounting/chart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const data = await res.json().catch(() => ({}))
    // Say WHAT it did. A sync that silently reports nothing leaves you unable to tell "already
    // up to date" from "it didn't run" — and the accruals depend on specific accounts existing.
    setSeedMsg(
      res.ok
        ? (data.seeded > 0
            ? `Added ${data.seeded} account${data.seeded === 1 ? '' : 's'}: ${(data.accounts ?? []).map((a: any) => a.code).join(', ')}`
            : 'Chart already up to date — nothing to add.')
        : (data.error ?? 'Sync failed')
    )
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

  // Once the vehicle is onboarded this card has nothing left to say — the Status page
  // takes over. `alwaysShow` keeps it rendered on Status itself, where it IS the
  // remaining-setup surface.
  if (!alwaysShow && onboarded) return null

  return (
    <div className="border rounded-lg p-4 mb-6 bg-muted/20 space-y-3">
      <p className="text-sm font-medium">Onboarding this vehicle</p>

      {/* Step 1 — chart */}
      <div className="flex items-center gap-2 text-sm">
        {accountCount > 0
          ? <><Check className="h-4 w-4 text-green-600" /> <span className="text-muted-foreground">Chart of accounts seeded ({accountCount} accounts).</span>
              <button onClick={seed} disabled={seeding} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">{seeding ? 'Syncing…' : 'Sync accounts'}</button></>
          : <><span className="text-muted-foreground">1. Seed the chart of accounts.</span><Button size="sm" variant="outline" onClick={seed} disabled={seeding}>{seeding && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Seed chart</Button></>}
      </div>
      {seedMsg && <p className="text-xs text-muted-foreground pl-6">{seedMsg}</p>}

      {/* Step 2 — choose path */}
      <div className="text-sm">
        <p className="text-muted-foreground mb-1.5">2. How are you starting this vehicle?</p>
        <div className="flex flex-wrap gap-1.5">
          {(['full_history', 'cutover'] as const).map(p => (
            <button key={p} onClick={() => choosePath(p)}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${path === p ? 'border-foreground/30 bg-accent font-medium' : 'border-border text-muted-foreground hover:text-foreground'}`}>
              {p === 'full_history' ? 'Full history (reconstruct)' : 'Cutover opening balance'}
            </button>
          ))}
        </div>
      </div>

      {/* Full history: opening balances are DERIVED from the reconstructed ledger.
          Entering them would double-count the fund's entire contributed capital, so
          the step isn't offered at all. */}
      {path === 'full_history' && (
        <>
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal ml-4">
            <li><Link href={fundHref('bank')} className="underline underline-offset-2 hover:text-foreground">Import the bank history</Link> (CSV/XLS) — dated cash back to inception.</li>
            <li>Categorize, and match inflows to capital calls / the investment purchase.</li>
            <li><Link href={fundHref('schedule-of-investments')} className="underline underline-offset-2 hover:text-foreground">Replay the investment history</Link> — each purchase and mark posts on the date it happened, so gains land in the period they were earned.</li>
            <li><Link href={fundHref('status')} className="underline underline-offset-2 hover:text-foreground">Set the allocation terms</Link>, then <Link href={fundHref('periods')} className="underline underline-offset-2 hover:text-foreground">close each period</Link> to allocate P&amp;L to partners.</li>
            <li>Reconcile capital accounts against the LP snapshot (Reconciliation → Load from LP snapshot).</li>
          </ol>
          <p className="text-xs text-muted-foreground">
            No opening balances to enter — the ledger starts at inception, so they come from the history itself.
          </p>
        </>
      )}

      {path === 'cutover' && (
        <div className="text-sm space-y-2">
          <p className="text-muted-foreground">Generate opening balances from the LP data already in the platform (paid-in − distributions per LP), as of:</p>
          <div className="flex items-center gap-2">
            <input type="date" value={cutoverDate} onChange={e => setCutoverDate(e.target.value)} className="border rounded px-2 py-1.5 text-sm" />
            <Button size="sm" onClick={bootstrap} disabled={bootstrapping || !cutoverDate || accountCount === 0}>{bootstrapping && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Bootstrap opening balances</Button>
          </div>
          {bootstrapMsg && <p className="text-xs text-muted-foreground">{bootstrapMsg}</p>}
          <p className="text-xs text-muted-foreground">
            Prefer to type each LP&rsquo;s balance from their statement instead?{' '}
            <Link href={fundHref('opening-balances')} className="underline underline-offset-2 hover:text-foreground">Enter opening balances manually</Link>.
          </p>
        </div>
      )}

      {/* Step 3 — investments. Neither path put them on the ledger: the bank import
          brings in cash, the cutover bootstrap brings in capital, and the investments
          themselves are nobody's job. A vehicle can otherwise finish setup with a
          balance sheet holding no investments at all, which is simply wrong. */}
      {path && inv && inv.positions > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm border-t pt-3">
          {inv.booked ? (
            <>
              <Check className="h-4 w-4 text-green-600 shrink-0" />
              <span className="text-muted-foreground">
                Investments are on the ledger ({inv.positions} {inv.positions === 1 ? 'position' : 'positions'}).
              </span>
              <Link href={fundHref('schedule-of-investments')} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
                Schedule of investments
              </Link>
            </>
          ) : (
            <>
              <span className="text-muted-foreground">
                3. Book the {inv.positions} {inv.positions === 1 ? 'investment' : 'investments'} the tracker holds for this vehicle onto the ledger
                {path === 'full_history'
                  ? ' — replay the dated history so each mark lands in its own period.'
                  : ' — one snapshot at the cutover date.'}
              </span>
              <Button size="sm" variant="outline" asChild>
                <Link href={fundHref('schedule-of-investments')}>
                  {path === 'full_history' ? 'Replay investment history' : 'Book investments'}
                </Link>
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
