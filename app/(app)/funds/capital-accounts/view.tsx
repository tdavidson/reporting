'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLpPortalEnabled, useIsAdmin } from '@/components/feature-visibility-context'
import Link from 'next/link'
import { Loader2, Check, AlertTriangle, Landmark, ChevronRight, Share2, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch, useFundSeg } from '@/components/accounting-vehicle'
import { type PeriodPreset } from '@/lib/accounting/statement-period'
import { PeriodPicker } from '@/components/accounting/period-picker'
import { NoticeAction } from '@/components/accounting/notice-action'
import { ReconciliationPanel } from './reconciliation-panel'
import { type CapitalSource } from '@/lib/accounting/capital-source'
import { GpPanel } from './gp-panel'
import { useCanRead } from '@/components/access-context'
import { CapitalRollforwardTable, type Row } from '@/components/accounting/capital-rollforward-table'
import { EmptyState } from '@/components/ui/empty-state'

interface CallLine { lpEntityId: string; name: string; amount: number }
interface CallRow { id: string; callDate: string; description: string | null; scope: string; total: number; lines: CallLine[] }
interface DistRow { distributionId: string; date: string; description: string | null; total: number; lines: CallLine[] }
interface Period { preset: PeriodPreset; start: string | null; end: string | null; label: string }

export function CapitalAccountsView() {
  const lpPortalEnabled = useLpPortalEnabled()
  const isAdmin = useIsAdmin()
  const canReadGpEconomics = useCanRead('gp_economics')
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const lf = useLedgerFetch()
  const fundSeg = useFundSeg()

  const [rows, setRows] = useState<Row[]>([])
  const [calls, setCalls] = useState<CallRow[]>([])
  const [dists, setDists] = useState<DistRow[]>([])
  const [nav, setNav] = useState(0)
  const [period, setPeriod] = useState<Period | null>(null)
  const [loading, setLoading] = useState(true)
  // Which producer this vehicle's capital comes from. Null until the first load — the
  // mode-specific parts of the page stay hidden rather than flashing the wrong ones.
  const [source, setSource] = useState<CapitalSource | null>(null)
  // Capital stranded on the pooled account. Reported by the API because it's the one thing
  // that makes every number on this page a lie while looking like a fund with no capital.
  const [stranded, setStranded] = useState<{ stranded: boolean; message: string | null; taggedPostings: number; pooledPostings: number } | null>(null)
  const [fixing, setFixing] = useState(false)
  const [fixMsg, setFixMsg] = useState<string | null>(null)

  const [preset, setPreset] = useState<PeriodPreset>('itd')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [asOf, setAsOf] = useState('') // report/period-end date; '' = Latest (today)
  const [search, setSearch] = useState('')

  const [err, setErr] = useState<string | null>(null)

  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState<{ count: number; errors: string[] } | null>(null)
  // Share-with-LPs dialog: which LPs' statements to publish to the portal.
  const [showShare, setShowShare] = useState(false)
  const [shareSel, setShareSel] = useState<Set<string>>(new Set())

  // Issue-a-call (folded in from the old Capital calls page).
  const [showCall, setShowCall] = useState(false)
  // The panel does BOTH directions. A call and a distribution take the same inputs — date,
  // description, an amount per partner — and differ only in the pro-rata basis and which
  // obligation they create, so one panel is honest rather than two near-identical ones.
  const [kind, setKind] = useState<'call' | 'distribution'>('call')
  const isDist = kind === 'distribution'
  const [mode, setMode] = useState<'fund_wide' | 'per_lp'>('fund_wide')
  const [callDate, setCallDate] = useState('')
  const [description, setDescription] = useState('')
  const [callTotal, setCallTotal] = useState('')
  // Calls only: a notice is a demand with a deadline, and the deadline is recorded at issue.
  const [dueDate, setDueDate] = useState('')
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [issuing, setIssuing] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    const qs = new URLSearchParams()
    if (preset === 'custom') {
      if (start) qs.set('start', start)
      if (end) qs.set('end', end)
      qs.set('preset', 'custom')
    } else {
      qs.set('preset', preset)
      if (asOf) qs.set('asOf', asOf)
    }
    lf(`/api/accounting/capital-accounts?${qs}`)
      .then(r => (r.ok ? r.json() : { rows: [], nav: 0, calls: [] }))
      .then(d => {
        setRows(d.rows ?? []); setNav(d.nav ?? 0); setPeriod(d.period ?? null)
        setCalls(d.calls ?? []); setSource(d.source ?? null); setStranded(d.stranded ?? null)
      })
      .then(() => lf('/api/accounting/distributions').then(r => (r.ok ? r.json() : [])))
      .then(d => { setDists(Array.isArray(d) ? d : [])
      })
      .finally(() => setLoading(false))
  }, [lf, preset, start, end, asOf])
  useEffect(() => { load() }, [load])

  // A capital-tracking-only vehicle keeps no double-entry books, so the affordances that
  // only exist inside one — issuing a call against a 1300 receivable, tying out a ledger
  // to the outgoing administrator's statement — are not shown for it. Its capital is
  // entered as events instead, below the roll-forward those events produce.
  const isEvents = source === 'events'

  // Open the share dialog with every LP selected by default.
  function openShare() {
    setShareSel(new Set(rows.map(r => r.lpEntityId)))
    setPublishResult(null); setErr(null)
    setShowShare(true)
  }

  async function publishStatements() {
    if (!period) return
    setPublishing(true); setErr(null); setPublishResult(null)
    const periodBody = period.preset === 'custom' ? { start: period.start, end: period.end } : { preset: period.preset }
    const res = await lf('/api/accounting/lp-statement/publish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...periodBody, lpEntityIds: Array.from(shareSel) }),
    })
    const data = await res.json()
    setPublishing(false)
    if (!res.ok) { setErr(data.error ?? 'Could not publish statements'); return }
    setPublishResult({ count: data.count ?? 0, errors: data.errors ?? [] })
  }

  const enteredTotal = rows.reduce((s, r) => s + (Number(amounts[r.lpEntityId]) || 0), 0)

  async function splitProRata() {
    const t = Number(callTotal)
    if (!Number.isFinite(t) || t <= 0) { setMsg({ ok: false, text: 'Enter a positive total to split' }); return }
    const res = await lf(isDist ? '/api/accounting/distributions' : '/api/accounting/capital-calls', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'preview', total: t }),
    })
    const data = await res.json()
    if (!res.ok) { setMsg({ ok: false, text: data.error ?? 'Could not split' }); return }
    const next: Record<string, string> = {}
    for (const l of (data.lines ?? [])) next[l.lpEntityId] = String(l.amount)
    setAmounts(next); setMsg(null)
  }

  async function issue() {
    setMsg(null)
    const lines = rows
      .map(r => ({ lpEntityId: r.lpEntityId, amount: Number(amounts[r.lpEntityId]) || 0 }))
      .filter(l => l.amount > 0)
    if (lines.length === 0) { setMsg({ ok: false, text: 'Enter at least one LP amount' }); return }
    if (!callDate) { setMsg({ ok: false, text: isDist ? 'Pick a distribution date' : 'Pick a call date' }); return }
    setIssuing(true)
    const res = await lf(isDist ? '/api/accounting/distributions' : '/api/accounting/capital-calls', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: isDist
        ? JSON.stringify({ action: 'declare', distributionDate: callDate, description: description || null, lines })
        : JSON.stringify({ action: 'issue', callDate, dueDate: dueDate || null, description: description || null, scope: mode, lines }),
    })
    const data = await res.json()
    setIssuing(false)
    if (!res.ok) { setMsg({ ok: false, text: data.error ?? (isDist ? 'Could not declare distribution' : 'Could not issue call') }); return }
    setMsg({ ok: true, text: isDist ? 'Distribution declared. The wire that pays it will match automatically.' : 'Call issued.' })
    setAmounts({}); setCallTotal(''); setDescription('')
    load()
  }

  // Repair from here. The Setup page hides these tools once a vehicle counts as "onboarded"
  // — which is judged on accounts and partners existing, not on capital reaching anyone — so
  // the one place the problem is visible had no way to act on it.
  async function attributeNow() {
    if (!window.confirm('Create each partner\u2019s capital account and move the pooled LP capital onto it? Balance-sheet neutral; postings in a closed period are skipped.')) return
    setFixing(true); setFixMsg(null)
    try {
      const res = await lf('/api/accounting/attribute-lp-capital', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setFixMsg(d.error ?? 'Attribution failed'); return }
      setFixMsg(`Created ${d.accountsCreated} accounts, attributed ${d.moved} postings.`
        + (d.untagged ? ` ${d.untagged} carry no LP and need splitting by hand.` : '')
        + (d.closedSkipped ? ` ${d.closedSkipped} skipped \u2014 reopen those periods to include them.` : ''))
      load()
    } finally {
      setFixing(false)
    }
  }

  return (
    <div className="space-y-3">
      {stranded?.stranded && (
        <div className="rounded-lg border border-warning bg-warning-subtle px-3 py-2.5 text-sm">
          <p className="font-medium">LP capital is not attributed to partner accounts</p>
          <p className="mt-0.5 text-muted-foreground">{stranded.message}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={attributeNow} disabled={fixing}>
              {fixing && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Attribute now
            </Button>
            {fixMsg && <span className="text-xs text-muted-foreground">{fixMsg}</span>}
          </div>
        </div>
      )}

      {/* The action row. The statement-period select sits on the RIGHT of the same row (via
          ml-auto) rather than in its own box — one control strip instead of two stacked
          panels. Choosing the capital source (ledger vs capital tracking) lives on the Admin
          page now; it is a fund-setup decision, not something to re-confront on every visit. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs w-full sm:w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search LPs…"
            className="w-full pl-8 pr-8 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {!isEvents && (
          <>
            <Button size="sm" variant="outline" className="text-muted-foreground" onClick={() => { setKind('call'); setShowCall(v => !(v && !isDist)) }} disabled={rows.length === 0}>
              <Landmark className="h-4 w-4 mr-1" />Issue a capital call
            </Button>
            <Button size="sm" variant="outline" className="text-muted-foreground" onClick={() => { setKind('distribution'); setShowCall(v => !(v && isDist)) }} disabled={rows.length === 0}>
              <Landmark className="h-4 w-4 mr-1" />Declare a distribution
            </Button>
          </>
        )}
        {/* Same "Share with LPs" action as the LPs report page: pick which LPs, publish to the
            portal, no email. Only offered when the portal is on — publishing statements nobody
            can open is a no-op that looks like success. */}
        {lpPortalEnabled && (
          <Button size="sm" variant="outline" className="text-muted-foreground" onClick={openShare} disabled={rows.length === 0}>
            <Share2 className="h-4 w-4 mr-1" />
            Share with LPs
          </Button>
        )}
        {err && !showShare && <span className="text-sm text-warning">{err}</span>}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* "As of" report date + Latest — same control and placement as /lps. The preset
              chooses the window ENDING at this date; custom mode uses its own from/to instead. */}
          <PeriodPicker
            preset={preset} onPreset={setPreset}
            start={start} end={end} onStart={setStart} onEnd={setEnd}
            asOf={asOf} onAsOf={setAsOf}
            allowAsOf
            title={period && period.preset !== 'itd' && period.start ? `Beginning capital is the balance carried in before ${period.start}` : 'All activity since inception'}
          />
        </div>
      </div>

      {/* Share statements with LPs — the same pick-then-publish, no-email flow as the LPs report
          page. Each selected LP's statement is generated and published to their portal. */}
      <Dialog open={showShare} onOpenChange={o => { if (!o) setShowShare(false) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Share statements with LPs</DialogTitle>
            <DialogDescription>
              Publish each selected LP&rsquo;s capital-account statement for {period?.label ?? 'this period'} to their
              portal. No email is sent — LPs see it when they sign in.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{shareSel.size} of {rows.length} selected</span>
              <button
                onClick={() => setShareSel(shareSel.size === rows.length ? new Set() : new Set(rows.map(r => r.lpEntityId)))}
                className="text-[11px] text-primary hover:underline"
              >
                {shareSel.size === rows.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="rounded-md border divide-y max-h-[45vh] overflow-y-auto min-w-0">
              {rows.map(r => (
                <label key={r.lpEntityId} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/30 min-w-0">
                  <input
                    type="checkbox"
                    checked={shareSel.has(r.lpEntityId)}
                    onChange={() => setShareSel(prev => { const n = new Set(prev); n.has(r.lpEntityId) ? n.delete(r.lpEntityId) : n.add(r.lpEntityId); return n })}
                    className="h-3.5 w-3.5 shrink-0"
                  />
                  <span className="flex-1 min-w-0 truncate">{r.name}</span>
                </label>
              ))}
            </div>

            {err && <p className="text-sm text-warning">{err}</p>}
            {publishResult && (
              <div className="rounded-md border p-2.5 text-sm space-y-1">
                <p className="flex items-center gap-1.5 text-success">
                  <Check className="h-4 w-4" />
                  Published {publishResult.count} statement{publishResult.count === 1 ? '' : 's'} for {period?.label} to the LP portal.
                </p>
                {publishResult.errors.map((e, i) => <p key={i} className="text-sm text-warning">{e}</p>)}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowShare(false)}>Close</Button>
            <Button size="sm" onClick={publishStatements} disabled={publishing || shareSel.size === 0}>
              {publishing && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Publish {shareSel.size > 0 ? `${shareSel.size} ` : ''}statement{shareSel.size === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Issue a call — folded in from the old Capital calls page. Gated on `!isEvents` as
          well as `showCall`: switching vehicle while the panel is open would otherwise leave
          it showing on a vehicle that has no receivable to call against. */}
      {showCall && !isEvents && rows.length > 0 && (
        <div className="border rounded-card p-4 space-y-3">
          <p className="text-sm font-medium">{isDist ? 'Declare a distribution' : 'Issue a capital call'}</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted-foreground">Date
              <input type="date" value={callDate} onChange={e => setCallDate(e.target.value)} className="block mt-1 border border-input rounded px-2 py-1.5 text-sm bg-transparent" />
            </label>
            {!isDist && (
              <label className="text-xs text-muted-foreground">Due
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="block mt-1 border border-input rounded px-2 py-1.5 text-sm bg-transparent" />
              </label>
            )}
            <label className="text-xs text-muted-foreground flex-1 min-w-[180px]">Description
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder={isDist ? "e.g. Q3 2026 distribution — Acme exit" : "e.g. Call #3 — new investment"} className="block mt-1 w-full border border-input rounded px-2 py-1.5 text-sm bg-transparent" />
            </label>
            {/* Scope is a CALL concept — it records whether the call went to the whole fund or
                to named partners. A distribution has no such register, so it isn't offered. */}
            {!isDist && <div className="text-xs text-muted-foreground">
              <span className="block mb-1">Type</span>
              <div className="inline-flex rounded border border-input overflow-hidden">
                <button type="button" onClick={() => setMode('fund_wide')} className={`px-2.5 py-1.5 text-xs ${mode === 'fund_wide' ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}>Fund-wide</button>
                <button type="button" onClick={() => setMode('per_lp')} className={`px-2.5 py-1.5 text-xs border-l border-input ${mode === 'per_lp' ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}>Per-LP</button>
              </div>
            </div>}
          </div>

          {(isDist || mode === 'fund_wide') && (
            <div className="flex items-end gap-2">
              <label className="text-xs text-muted-foreground">{isDist ? 'Total to distribute' : 'Total to call'}
                <input value={callTotal} onChange={e => setCallTotal(e.target.value)} inputMode="decimal" placeholder="0.00" className="block mt-1 border border-input rounded px-2 py-1.5 text-sm font-mono bg-transparent w-40" />
              </label>
              <Button size="sm" variant="outline" onClick={splitProRata}>Split pro-rata</Button>
              <span className="text-xs text-muted-foreground pb-2">{isDist ? 'Fills each partner by capital balance — edit any row below.' : 'Fills each LP by commitment — edit any row below.'}</span>
            </div>
          )}

          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-3 py-2 font-medium">Partner</th>
                  <th className="text-right px-3 py-2 font-medium">Commitment</th>
                  <th className="text-right px-3 py-2 font-medium">{isDist ? 'Capital balance' : 'Unfunded'}</th>
                  <th className="text-right px-3 py-2 font-medium">{isDist ? 'Distribution' : 'Call amount'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.lpEntityId} className="border-b last:border-b-0">
                    <td className="px-3 py-2 max-w-[200px]"><div className="truncate" title={r.name}>{r.name}</div></td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt(r.commitment)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt(isDist ? r.ending : r.outstanding)}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        value={amounts[r.lpEntityId] ?? ''}
                        onChange={e => setAmounts(a => ({ ...a, [r.lpEntityId]: e.target.value }))}
                        inputMode="decimal"
                        placeholder="0.00"
                        className="border border-input rounded px-2 py-1 text-sm tabular-nums bg-transparent w-32 text-right"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/30 font-semibold">
                  <td className="px-3 py-2" colSpan={3}>{isDist ? 'Distribution total' : 'Call total'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(enteredTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={issue} disabled={issuing || enteredTotal <= 0}>
              {issuing && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}{isDist ? 'Declare distribution' : 'Issue call'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowCall(false)} disabled={issuing}>Cancel</Button>
            {msg && (
              <span className={`text-sm flex items-center gap-1 ${msg.ok ? 'text-success' : 'text-warning'}`}>
                {msg.ok ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{msg.text}
              </span>
            )}
          </div>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          action={fundSeg && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/funds/${fundSeg}/opening-balances`}>Import opening balances</Link>
            </Button>
          )}
        >
          No capital accounts yet. Add a partner above, or start from opening balances.
        </EmptyState>
      ) : (
        <CapitalRollforwardTable
          rows={rows}
          scope={period ? { preset: period.preset, start: period.start } : { preset: 'itd' }}
          fmt={fmt}
          search={search}
          metrics
          lpHref={fundSeg ? (id) => `/funds/${fundSeg}/capital-accounts/${id}` : undefined}
        />
      )}

      {calls.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2 mt-4">Issued calls</p>
          <div className="space-y-2">
            {calls.map(c => (
              <div key={c.id} className="border rounded-card p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{c.callDate} · {fmt(c.total)}</span>
                  <span className="text-xs text-muted-foreground">{c.scope === 'fund_wide' ? 'Fund-wide' : 'Per-LP'}</span>
                </div>
                {c.description && <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>}
                <div className="mt-2 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5">
                  {c.lines.map(l => <span key={l.lpEntityId}>{l.name}: <span className="tabular-nums">{fmt(l.amount)}</span></span>)}
                </div>
                <NoticeAction kind="capital_call" id={c.id} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Declared distributions — the outbound register, read the same way. */}
      {dists.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2 mt-4">Declared distributions</p>
          <div className="space-y-2">
            {dists.map(d => (
              <div key={d.distributionId} className="border rounded-card p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{d.date} · {fmt(d.total)}</span>
                </div>
                {d.description && <p className="text-xs text-muted-foreground mt-0.5">{d.description}</p>}
                <div className="mt-2 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5">
                  {d.lines.map(l => <span key={l.lpEntityId}>{l.name}: <span className="tabular-nums">{fmt(l.amount)}</span></span>)}
                </div>
                <NoticeAction kind="distribution" id={d.distributionId} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The entry surface for a capital-tracking-only vehicle. It sits BELOW the
          roll-forward because the roll-forward is what it produces — the same order the
          Journal has to the statements it feeds. */}
      {/* A capital-tracking vehicle is now EDITED as dated positions, in the LPs section —
          not as capital events here (that store is no longer read). Point there rather than
          showing a panel whose writes would go nowhere. */}
      {isEvents && (
        <div className="pt-6">
          <div className="rounded-card border p-4 text-sm text-muted-foreground">
            This vehicle is capital-tracked. Add or edit its LP positions on the{' '}
            <Link href="/lps/capital" className="text-foreground underline underline-offset-4">LP capital accounts</Link>{' '}
            page.
          </div>
        </div>
      )}

      {/* GP / associate entity economics — a DIFFERENT access domain from the capital accounts
          it sits beside. It carries the partners' carry points and carry accrued/paid, so a
          member who can read capital accounts is not thereby entitled to it. Its own API is
          gated to gp_economics too; this only spares them a panel that would fail to load.

          It also renders itself to nothing on an ordinary vehicle. */}
      {canReadGpEconomics && (
        <div className="pt-6">
          <GpPanel isAdmin={isAdmin} />
        </div>
      )}

      {/* Reconciling against the incumbent administrator's statement compares one
          partner's capital account, line by line — so it belongs with the capital
          accounts, not on Admin.

          It is a CUTOVER check, not a monthly step: it proves this ledger reproduces
          the numbers the outgoing admin produced. Once you are closing periods here,
          the ledger IS the record and there is nothing external left to reconcile
          against. Hence collapsed, and last. Ledger-only: on a capital-tracking vehicle
          the events ARE the administrator's statement, so there is nothing to tie out to. */}
      {!isEvents && (
      <details className="group border rounded-lg mt-6">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium">
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
          Tie out to an administrator&rsquo;s statement
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            a takeover check — prove these accounts reproduce theirs, per partner, per line
          </span>
        </summary>
        <div className="border-t p-3">
          <ReconciliationPanel />
        </div>
      </details>
      )}
    </div>
  )
}
