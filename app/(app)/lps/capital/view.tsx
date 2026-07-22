'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, ClipboardPaste, Trash2, X, BookOpen, ListTree, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useConfirm } from '@/components/confirm-dialog'
import { useCurrency, formatCurrencyFull } from '@/components/currency-context'
import { CapitalRollforwardTable, type Row, type CapitalEdit } from '@/components/accounting/capital-rollforward-table'

// The capital-accounts API returns the full per-LP Row for BOTH producers (ledger and pasted
// positions), so this surface renders the same table as /funds/[id]/capital-accounts.
interface AcctResp { rows: Row[]; nav: number; source: 'ledger' | 'events'; period?: unknown }

interface Position {
  lpEntityId: string
  name: string
  asOfDate: string
  commitment: number | null
  calledCapital: number | null
  distributions: number | null
  nav: number | null
  irr: number | null
}

export function LpCapitalView({ isAdmin }: { isAdmin: boolean }) {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyFull(v, currency)
  const confirm = useConfirm()

  const [vehicles, setVehicles] = useState<string[]>([])
  const [group, setGroup] = useState<string>('')
  const [acct, setAcct] = useState<AcctResp | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [dates, setDates] = useState<string[]>([]) // most-recent first
  const [selectedDate, setSelectedDate] = useState<string>('') // '' = Latest (free 'as of' picker)
  const [ledgerAsOf, setLedgerAsOf] = useState<string>('') // ledger view: arbitrary report date, '' = today
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/accounting/vehicles')
      .then(r => (r.ok ? r.json() : []))
      .then((v: string[]) => { setVehicles(Array.isArray(v) ? v : []); if (v?.length) setGroup(g => g || v[0]) })
  }, [])

  const load = useCallback(() => {
    if (!group) return
    setLoading(true)
    // One "as of" for both producers: the tracking date select or the ledger report date. The API
    // re-derives the accounts to that date (resolving a tracking pick to the latest stored on-or-before).
    const asOf = selectedDate || ledgerAsOf
    const acctUrl = `/api/accounting/capital-accounts?group=${encodeURIComponent(group)}${asOf ? `&asOf=${asOf}` : ''}`
    Promise.all([
      fetch(acctUrl).then(r => (r.ok ? r.json() : null)),
      fetch(`/api/accounting/positions?group=${encodeURIComponent(group)}`).then(r => (r.ok ? r.json() : null)),
    ]).then(([a, p]) => {
      setAcct(a)
      setPositions(p?.positions ?? [])
      setDates(p?.dates ?? [])
    }).finally(() => setLoading(false))
  }, [group, selectedDate, ledgerAsOf])
  useEffect(() => { load() }, [load])

  // Switching vehicles resets both date pickers back to Latest.
  useEffect(() => { setSelectedDate(''); setLedgerAsOf('') }, [group])

  const isTracking = acct?.source !== 'ledger'
  // Free "as of" picker: resolve to the latest stored position on-or-before the picked date
  // (dates is most-recent-first, so the first one ≤ the pick is the latest ≤). Empty = Latest.
  const resolvedDate = useMemo(() => {
    if (!selectedDate) return dates[0] ?? ''
    return dates.find(d => d <= selectedDate) ?? ''
  }, [selectedDate, dates])

  // Inline edit → write the LP's position for the shown date, then reload so the derived table refreshes.
  const savePosition = useCallback(async (lpEntityId: string, patch: CapitalEdit) => {
    const asOfDate = resolvedDate || dates[0]
    if (!asOfDate) return
    await fetch('/api/accounting/positions', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group, asOfDate, lpEntityId,
        commitment: patch.commitment, calledCapital: patch.calledCapital,
        distributions: patch.distributions, nav: patch.nav, irr: patch.irr,
      }),
    })
    load()
  }, [group, resolvedDate, dates, load])

  return (
    <div className="space-y-4">
      {/* Vehicle bar — above the title, matching the Funds sub-pages. */}
      <div className="text-sm flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Vehicle</span>
        {vehicles.length <= 1 ? (
          <span className="font-medium">{group || '—'}</span>
        ) : (
          <select
            value={group}
            onChange={e => setGroup(e.target.value)}
            className="rounded border bg-transparent px-2 py-1 text-sm"
          >
            {vehicles.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
        {acct && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground ml-1">
            {acct.source === 'ledger' ? <BookOpen className="h-3.5 w-3.5" /> : <ListTree className="h-3.5 w-3.5" />}
            {acct.source === 'ledger' ? 'Derived from the ledger' : 'Pasted positions'}
          </span>
        )}
      </div>

      {/* Title — same as /funds/[id]/capital-accounts. */}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Capital accounts</h1>
        <p className="text-sm text-muted-foreground">Limited partner roll-forward per period</p>
      </div>

      {/* Action bar — search left; the "As of" date right-aligned. A tracking vehicle navigates its
          stored snapshot dates; an accounting vehicle picks an arbitrary report date. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-xs w-full sm:w-64">
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

        {isTracking && dates.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">As of</label>
            <Input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="h-9 w-40" />
            {selectedDate && <Button size="sm" variant="ghost" onClick={() => setSelectedDate('')}>Latest</Button>}
            {selectedDate && resolvedDate && resolvedDate !== selectedDate && (
              <span className="text-xs text-muted-foreground">showing {resolvedDate}</span>
            )}
          </div>
        )}
        {!isTracking && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">As of</label>
            <Input type="date" value={ledgerAsOf} onChange={e => setLedgerAsOf(e.target.value)} className="h-9 w-40" />
            {ledgerAsOf && <Button size="sm" variant="ghost" onClick={() => setLedgerAsOf('')}>Latest</Button>}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : (
        <>
          {/* One table for both producers — the roll-forward plus performance ratios. A pasted
              vehicle's amount columns are editable inputs; an accounting vehicle's are calculated. */}
          <CapitalRollforwardTable
            rows={acct?.rows ?? []}
            scope={{ preset: 'itd' }}
            fmt={fmt}
            search={search}
            metrics
            editable={isTracking && isAdmin ? { onSave: savePosition } : undefined}
          />

          {isTracking ? (
            <>
              {/* The tracked history — one row per stored date; click to view/edit that snapshot. */}
              {dates.length > 0 && (
                <HistoryTable
                  positions={positions}
                  dates={dates}
                  activeDate={resolvedDate}
                  onSelect={d => setSelectedDate(d)}
                  onDelete={isAdmin ? async (d) => {
                    const ok = await confirm({ title: `Delete the ${d} positions?`, description: 'Removes every LP position stored for this date on this vehicle.', confirmLabel: 'Delete', variant: 'destructive' })
                    if (!ok) return
                    await fetch(`/api/accounting/positions?group=${encodeURIComponent(group)}&asOfDate=${d}`, { method: 'DELETE' })
                    load()
                  } : undefined}
                  fmt={fmt}
                />
              )}

              {isAdmin ? <ImportBox group={group} onImported={load} /> : (
                <p className="text-xs text-muted-foreground">Capital tracking is admin-edited.</p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              This vehicle is on the ledger — its capital accounts are derived from posted entries. Manage entries in the Funds section.
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// History table — one row per stored date
// ---------------------------------------------------------------------------

function HistoryTable({
  positions, dates, activeDate, onSelect, onDelete, fmt,
}: {
  positions: Position[]
  dates: string[]
  activeDate: string
  onSelect: (d: string) => void
  onDelete?: (d: string) => void
  fmt: (v: number) => string
}) {
  const byDate = useMemo(() => {
    const m = new Map<string, { lps: number; commitment: number; called: number; distributions: number; nav: number }>()
    for (const d of dates) m.set(d, { lps: 0, commitment: 0, called: 0, distributions: 0, nav: 0 })
    for (const p of positions) {
      const agg = m.get(p.asOfDate)
      if (!agg) continue
      agg.lps += 1
      agg.commitment += p.commitment ?? 0
      agg.called += p.calledCapital ?? 0
      agg.distributions += p.distributions ?? 0
      agg.nav += p.nav ?? 0
    }
    return m
  }, [positions, dates])

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium">History</h2>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2 font-medium">As of</th>
              <th className="text-right px-3 py-2 font-medium">LPs</th>
              <th className="text-right px-3 py-2 font-medium">Committed</th>
              <th className="text-right px-3 py-2 font-medium">Called</th>
              <th className="text-right px-3 py-2 font-medium">Distributions</th>
              <th className="text-right px-3 py-2 font-medium">NAV</th>
              {onDelete && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {dates.map(d => {
              const a = byDate.get(d)!
              return (
                <tr key={d} className={`border-t group cursor-pointer hover:bg-muted/20 ${d === activeDate ? 'bg-muted/30' : ''}`} onClick={() => onSelect(d)}>
                  <td className="px-3 py-1.5 font-medium">{d}{d === activeDate && <span className="ml-2 text-[10px] text-muted-foreground">shown above</span>}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{a.lps}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmt(a.commitment)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmt(a.called)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmt(a.distributions)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmt(a.nav)}</td>
                  {onDelete && (
                    <td className="px-3 py-1.5 text-right" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => onDelete(d)}
                        title={`Delete the entire ${d} set`}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-red-600 opacity-0 group-hover:opacity-100 focus:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete set
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Import box
// ---------------------------------------------------------------------------

function ImportBox({ group, onImported }: { group: string; onImported: () => void }) {
  const [asOfDate, setAsOfDate] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function doImport() {
    setBusy(true); setMsg(null)
    const res = await fetch('/api/accounting/positions/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group, asOfDate, data: text }),
    })
    const d = await res.json()
    setBusy(false)
    if (!res.ok) { setMsg(d.error ?? 'Import failed'); return }
    setMsg(`Imported ${d.written} positions as of ${d.asOfDate}.`)
    setText('')
    onImported()
  }

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ClipboardPaste className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Import</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Paste a statement — the AI maps the columns (commitment, called/paid-in, distributions, NAV, and Net IRR if present).
        Each import is the cumulative position as of a date; re-importing a date replaces it. The table above is derived
        from the dates you keep.
      </p>
      <label className="text-xs text-muted-foreground flex items-center gap-2">
        As of
        <Input type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)} className="h-9 w-40" />
      </label>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={8}
        placeholder="Paste spreadsheet rows (with headers): investor, commitment, called/paid-in, distributions, NAV, Net IRR…"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={doImport} disabled={busy || !asOfDate || !text.trim()}>
          {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Import
        </Button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>
    </div>
  )
}
