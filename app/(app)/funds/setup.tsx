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
  // The vehicle's current producer. When it is still 'events', finishing setup means ACTIVATING
  // fund accounting (flip to 'ledger') — the outcome of setup, not a separate mode switch.
  const [source, setSource] = useState<'ledger' | 'events' | null>(null)
  const [activating, setActivating] = useState(false)
  const [activateErr, setActivateErr] = useState<string | null>(null)
  // One-click turn-on is the DEFAULT for a tracking vehicle; the step-by-step setup is the manual
  // alternative behind a disclosure.
  const [turningOn, setTurningOn] = useState(false)
  const [turnOnErr, setTurnOnErr] = useState<string | null>(null)
  const [showManual, setShowManual] = useState(false)
  const [cutoverDate, setCutoverDate] = useState('')
  const [bootstrapping, setBootstrapping] = useState(false)
  const [bootstrapMsg, setBootstrapMsg] = useState<string | null>(null)
  // Attribute pooled LP capital (3100) onto per-LP accounts — preview then apply.
  const [attrPreview, setAttrPreview] = useState<{
    empty?: boolean; movable?: number; accountsToCreate?: number; closedSkipped?: number; untagged?: number
  } | null>(null)
  const [attrLoading, setAttrLoading] = useState(false)
  const [attrApplying, setAttrApplying] = useState(false)
  const [attrMsg, setAttrMsg] = useState<string | null>(null)
  const [attrError, setAttrError] = useState<string | null>(null)
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
    setSource(status?.source === 'ledger' ? 'ledger' : status?.source === 'events' ? 'events' : null)
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

  async function previewAttribution() {
    setAttrLoading(true); setAttrError(null); setAttrMsg(null)
    try {
      const res = await lf('/api/accounting/attribute-lp-capital', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setAttrError(data.error ?? 'Preview failed'); setAttrPreview(null); return }
      setAttrPreview(data)
    } catch (e: any) {
      setAttrError(e?.message ?? 'Preview failed')
    } finally {
      setAttrLoading(false)
    }
  }

  async function applyAttribution() {
    if (!window.confirm('Create the per-LP accounts and move pooled LP capital onto them? This writes to the ledger.')) return
    setAttrApplying(true); setAttrError(null)
    try {
      const res = await lf('/api/accounting/attribute-lp-capital', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setAttrError(data.error ?? 'Apply failed'); return }
      setAttrMsg(
        `Created ${data.accountsCreated} accounts, attributed ${data.moved} postings.` +
        (data.untagged ? ` ${data.untagged} still need manual handling.` : '')
      )
      setAttrPreview(null)
      await refresh()
    } catch (e: any) {
      setAttrError(e?.message ?? 'Apply failed')
    } finally {
      setAttrApplying(false)
    }
  }

  async function bootstrap() {
    if (!cutoverDate) return
    setBootstrapping(true); setBootstrapMsg(null)
    const res = await lf('/api/accounting/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entryDate: cutoverDate }) })
    const data = await res.json()
    setBootstrapMsg(res.ok ? `Booked opening balances for ${data.lpCount} LP(s).` : (data.error ?? 'Failed'))
    setBootstrapping(false)
  }

  // Finish adoption: flip the vehicle's producer to the ledger. Guarded server-side against an
  // empty chart (LP capital would read zero). Full reload so the Status page re-renders in ledger
  // mode — a one-time setup action, not a toggle.
  async function activate() {
    setActivating(true); setActivateErr(null)
    const res = await lf('/api/accounting/lp-events', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capitalSource: 'ledger' }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setActivateErr(data.error ?? 'Could not activate fund accounting'); setActivating(false); return }
    window.location.reload()
  }

  // One action: seed the chart, carry the latest pasted snapshot in as opening balances (cutover),
  // and flip to the ledger — all server-side. Full reload so Status re-renders in ledger mode.
  async function turnOn() {
    setTurningOn(true); setTurnOnErr(null)
    const res = await lf('/api/accounting/turn-on', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setTurnOnErr(data.error ?? 'Could not turn on fund accounting'); setTurningOn(false); return }
    window.location.reload()
  }

  if (accountCount === null) return null

  // Once the vehicle is onboarded this card has nothing left to say — the Status page
  // takes over. `alwaysShow` keeps it rendered on Status itself, where it IS the
  // remaining-setup surface.
  if (!alwaysShow && onboarded) return null

  return (
    <div className="border rounded-lg p-4 mb-6 bg-muted/20 space-y-3">
      <p className="text-sm font-medium">Onboarding this vehicle</p>

      {/* PRIMARY path for a tracking vehicle: one click does the whole turn-on. */}
      {source === 'events' && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Turn on fund accounting for this vehicle. This seeds the chart of accounts, carries your
            latest pasted positions in as opening balances, and starts deriving capital from the
            ledger. You can rebuild full history from inception later.
          </p>
          <Button size="sm" onClick={turnOn} disabled={turningOn}>
            {turningOn && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Turn on fund accounting
          </Button>
          {turnOnErr && <p className="text-xs text-destructive">{turnOnErr}</p>}
          {!showManual && (
            <button onClick={() => setShowManual(true)} className="block text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
              Set up manually instead
            </button>
          )}
        </div>
      )}

      {/* Manual, step-by-step setup — always shown for a ledger vehicle (post-turn-on deepening);
          behind the "Set up manually" disclosure for a tracking vehicle. */}
      {(source !== 'events' || showManual) && (
      <>
      {/* Step 1 — chart */}
      <div className="flex items-center gap-2 text-sm">
        {accountCount > 0
          ? <><Check className="h-4 w-4 text-green-600" /> <span className="text-muted-foreground">Chart of accounts seeded ({accountCount} accounts).</span>
              <button onClick={seed} disabled={seeding} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">{seeding ? 'Syncing…' : 'Sync accounts'}</button></>
          : <><span className="text-muted-foreground">1. Seed the chart of accounts.</span><Button size="sm" variant="outline" onClick={seed} disabled={seeding}>{seeding && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Seed chart</Button></>}
      </div>
      {seedMsg && <p className="text-xs text-muted-foreground pl-6">{seedMsg}</p>}

      {/* Attribute pooled LP capital (3100) onto per-LP accounts — optional, preview then apply. */}
      <div className="text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Attribute LP capital to per-LP accounts</span>
          <Button size="sm" variant="outline" onClick={previewAttribution} disabled={attrLoading || attrApplying}>
            {attrLoading && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Preview
          </Button>
        </div>
        {attrError && <p className="text-xs text-destructive mt-1">{attrError}</p>}
        {attrPreview && (
          <div className="mt-1.5 space-y-1">
            {attrPreview.empty ? (
              <p className="text-xs text-muted-foreground">Nothing to attribute — capital is already on per-LP accounts.</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  {attrPreview.accountsToCreate} account{attrPreview.accountsToCreate === 1 ? '' : 's'} to create, {attrPreview.movable} posting{attrPreview.movable === 1 ? '' : 's'} to attribute
                </p>
                {!!attrPreview.untagged && attrPreview.untagged > 0 && (
                  <p className="text-xs text-muted-foreground">{attrPreview.untagged} pooled posting{attrPreview.untagged === 1 ? '' : 's'} have no LP and need manual handling</p>
                )}
                {!!attrPreview.closedSkipped && attrPreview.closedSkipped > 0 && (
                  <p className="text-xs text-muted-foreground">{attrPreview.closedSkipped} skipped (closed period)</p>
                )}
                <Button size="sm" onClick={applyAttribution} disabled={attrApplying}>
                  {attrApplying && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Apply
                </Button>
              </>
            )}
          </div>
        )}
        {attrMsg && <p className="text-xs text-muted-foreground mt-1">{attrMsg}</p>}
      </div>

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

      {/* Activate — the LAST step. While this vehicle is still on LP tracking ('events'), finishing
          setup means switching its capital to the ledger. This is the ONLY place that happens now:
          there is no standalone mode toggle. Gated on a seeded chart (the server guard's hard floor);
          the steps above guide booking the opening balances/history first. */}
      {source === 'events' && accountCount > 0 && (
        <div className="border-t pt-3 space-y-2">
          <p className="text-sm text-muted-foreground">
            When the books are ready, activate fund accounting. This vehicle&rsquo;s capital will then be
            derived from the ledger, and the pasted-positions input is retired.
          </p>
          <Button size="sm" onClick={activate} disabled={activating}>
            {activating && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Activate fund accounting
          </Button>
          {activateErr && <p className="text-xs text-destructive">{activateErr}</p>}
        </div>
      )}
      </>
      )}
    </div>
  )
}
