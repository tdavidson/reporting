'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ClipboardPaste, Trash2, Pencil, Check, X, BookOpen, ListTree, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useConfirm } from '@/components/confirm-dialog'
import { useCurrency, formatCurrencyFull } from '@/components/currency-context'
import { xirr, type CashFlow } from '@/lib/xirr'

interface AcctRow {
  lpEntityId: string
  name: string
  commitment: number
  called: number
  funded: number
  itd: { distributions: number; ending: number }
}
interface AcctResp { rows: AcctRow[]; nav: number; source: 'ledger' | 'events'; period?: unknown }

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

const moicX = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}x`)
const pctX = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)
const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null)

/** Client-side IRR for one entity from its dated positions, terminal NAV at the latest date. */
function deriveIrr(sortedAsc: Position[], terminalDate: string): number | null {
  const flows: CashFlow[] = []
  let prevCalled = 0, prevDist = 0
  for (const p of sortedAsc) {
    const called = p.calledCapital ?? 0
    const dist = p.distributions ?? 0
    const dC = called - prevCalled
    const dD = dist - prevDist
    if (dC !== 0) flows.push({ date: new Date(p.asOfDate), amount: -dC }) // contribution: cash out
    if (dD !== 0) flows.push({ date: new Date(p.asOfDate), amount: dD })  // distribution: cash in
    prevCalled = called; prevDist = dist
  }
  const nav = sortedAsc[sortedAsc.length - 1]?.nav ?? 0
  if (nav !== 0) flows.push({ date: new Date(terminalDate), amount: nav })
  return xirr(flows)
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
    Promise.all([
      fetch(`/api/accounting/capital-accounts?group=${encodeURIComponent(group)}`).then(r => (r.ok ? r.json() : null)),
      fetch(`/api/accounting/positions?group=${encodeURIComponent(group)}`).then(r => (r.ok ? r.json() : null)),
    ]).then(([a, p]) => {
      setAcct(a)
      setPositions(p?.positions ?? [])
      setDates(p?.dates ?? [])
    }).finally(() => setLoading(false))
  }, [group])
  useEffect(() => { load() }, [load])

  // Switching vehicles resets the date back to Latest.
  useEffect(() => { setSelectedDate('') }, [group])

  const isTracking = acct?.source !== 'ledger'
  // Free "as of" picker: resolve to the latest stored position on-or-before the picked date
  // (dates is most-recent-first, so the first one ≤ the pick is the latest ≤). Empty = Latest.
  const resolvedDate = useMemo(() => {
    if (!selectedDate) return dates[0] ?? ''
    return dates.find(d => d <= selectedDate) ?? ''
  }, [selectedDate, dates])

  return (
    <div className="space-y-6">
      {/* Vehicle + date selectors — the LPs section has no accounting vehicle bar, so they're local. */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted-foreground">Vehicle</label>
        <select
          value={group}
          onChange={e => setGroup(e.target.value)}
          className="h-9 px-3 rounded-md border border-input bg-background text-sm"
        >
          {vehicles.map(v => <option key={v} value={v}>{v}</option>)}
        </select>

        {isTracking && dates.length > 0 && (
          <>
            {/* Free "as of" picker + Latest — same control and placement as /lps. */}
            <label className="text-sm text-muted-foreground ml-1">As of</label>
            <Input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="h-9 w-40" />
            {selectedDate && <Button size="sm" variant="ghost" onClick={() => setSelectedDate('')}>Latest</Button>}
            {selectedDate && resolvedDate && resolvedDate !== selectedDate && (
              <span className="text-xs text-muted-foreground">showing {resolvedDate}</span>
            )}
          </>
        )}

        {acct && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            {acct.source === 'ledger' ? <BookOpen className="h-3.5 w-3.5" /> : <ListTree className="h-3.5 w-3.5" />}
            {acct.source === 'ledger' ? 'from the ledger' : 'from tracked positions'}
          </span>
        )}
      </div>

      {/* Search — mirrors the /lps investor search. */}
      {isTracking && (
        <div className="relative max-w-xs">
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
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : !isTracking ? (
        /* Ledger vehicle — the statement comes from posted entries; edit it in the Funds section. */
        <>
          <LedgerTable rows={acct?.rows ?? []} fmt={fmt} />
          <p className="text-xs text-muted-foreground">
            This vehicle is on the ledger — its capital accounts come from posted entries. Edit them in the Funds section.
          </p>
        </>
      ) : (
        <>
          {/* Top table: the selected date's positions, with derived metrics and inline edit. */}
          <PositionsTable
            group={group}
            date={resolvedDate}
            allPositions={positions}
            search={search}
            editable={isAdmin}
            onSaved={load}
            fmt={fmt}
          />

          {/* Second table: the tracked history — one row per stored date. */}
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

          {/* Import — its own box. */}
          {isAdmin ? <ImportBox group={group} onImported={load} /> : (
            <p className="text-xs text-muted-foreground">Capital tracking is admin-edited.</p>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ledger view (read-only)
// ---------------------------------------------------------------------------

function LedgerTable({ rows, fmt }: { rows: AcctRow[]; fmt: (v: number) => string }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground bg-muted/40">
          <tr>
            <th className="text-left px-3 py-2 font-medium">LP</th>
            <th className="text-right px-3 py-2 font-medium">Committed</th>
            <th className="text-right px-3 py-2 font-medium">Called / paid-in</th>
            <th className="text-right px-3 py-2 font-medium">Distributions</th>
            <th className="text-right px-3 py-2 font-medium">NAV</th>
            <th className="text-right px-3 py-2 font-medium">% Funded</th>
            <th className="text-right px-3 py-2 font-medium">DPI</th>
            <th className="text-right px-3 py-2 font-medium">RVPI</th>
            <th className="text-right px-3 py-2 font-medium">TVPI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const nav = r.itd.ending
            const dist = r.itd.distributions
            return (
              <tr key={r.lpEntityId} className="border-t">
                <td className="px-3 py-1.5 font-medium">{r.name}</td>
                <td className="px-3 py-1.5 text-right font-mono">{fmt(r.commitment)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{fmt(r.called)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{fmt(-dist)}</td>
                <td className="px-3 py-1.5 text-right font-mono font-medium">{fmt(nav)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{pctX(ratio(r.called, r.commitment))}</td>
                <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{moicX(ratio(-dist, r.called))}</td>
                <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{moicX(ratio(nav, r.called))}</td>
                <td className="px-3 py-1.5 text-right font-mono">{moicX(ratio(-dist + nav, r.called))}</td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground text-sm">This ledger has no capital postings yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Top table — positions for the selected date, with metrics + inline edit
// ---------------------------------------------------------------------------

function PositionsTable({
  group, date, allPositions, search, editable, onSaved, fmt,
}: {
  group: string
  date: string
  allPositions: Position[]
  search: string
  editable: boolean
  onSaved: () => void
  fmt: (v: number) => string
}) {
  // Positions for the shown date, and each entity's full history (ascending) for IRR.
  const byEntityAsc = useMemo(() => {
    const m = new Map<string, Position[]>()
    for (const p of allPositions) {
      const list = m.get(p.lpEntityId) ?? []
      list.push(p)
      m.set(p.lpEntityId, list)
    }
    for (const list of Array.from(m.values())) list.sort((a, b) => a.asOfDate.localeCompare(b.asOfDate))
    return m
  }, [allPositions])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allPositions
      .filter(p => p.asOfDate === date && (!q || p.name.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [allPositions, date, search])

  if (!date || rows.length === 0) {
    return (
      <div className="overflow-x-auto rounded-lg border">
        <div className="px-3 py-8 text-center text-muted-foreground text-sm">
          No positions {date ? `as of ${date}` : 'yet'}. Import a statement below to get started.
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground bg-muted/40">
          <tr>
            <th className="text-left px-3 py-2 font-medium">LP</th>
            <th className="text-right px-3 py-2 font-medium">Committed</th>
            <th className="text-right px-3 py-2 font-medium">Called / paid-in</th>
            <th className="text-right px-3 py-2 font-medium">Distributions</th>
            <th className="text-right px-3 py-2 font-medium">NAV</th>
            <th className="text-right px-3 py-2 font-medium">% Funded</th>
            <th className="text-right px-3 py-2 font-medium">DPI</th>
            <th className="text-right px-3 py-2 font-medium">RVPI</th>
            <th className="text-right px-3 py-2 font-medium">TVPI</th>
            <th className="text-right px-3 py-2 font-medium">IRR</th>
            {editable && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {rows.map(p => {
            const history = (byEntityAsc.get(p.lpEntityId) ?? []).filter(h => h.asOfDate <= date)
            // Stored IRR wins; a single-date position has no time spread to derive one.
            const irr = p.irr != null ? p.irr : deriveIrr(history, date)
            return (
              <PositionRow key={p.lpEntityId} group={group} pos={p} irr={irr} editable={editable} onSaved={onSaved} fmt={fmt} />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PositionRow({
  group, pos, irr, editable, onSaved, fmt,
}: {
  group: string
  pos: Position
  irr: number | null
  editable: boolean
  onSaved: () => void
  fmt: (v: number) => string
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({
    commitment: pos.commitment ?? '', calledCapital: pos.calledCapital ?? '',
    distributions: pos.distributions ?? '', nav: pos.nav ?? '',
    irr: pos.irr ?? '',
  })
  const [saving, setSaving] = useState(false)

  const called = pos.calledCapital ?? 0
  const dist = pos.distributions ?? 0
  const nav = pos.nav ?? 0

  // Open this LP's capital-account detail (under /funds). That page reads the selected vehicle
  // from the shared `acct_vehicle` localStorage key, so set it here before navigating — the LPs
  // section has no accounting VehicleProvider of its own.
  function openLp() {
    try { localStorage.setItem('acct_vehicle', group) } catch { /* ignore */ }
    router.push(`/funds/capital-accounts/${pos.lpEntityId}`)
  }

  async function save() {
    setSaving(true)
    await fetch('/api/accounting/positions', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group, asOfDate: pos.asOfDate, lpEntityId: pos.lpEntityId, ...draft }),
    })
    setSaving(false); setEditing(false); onSaved()
  }

  const cell = (v: number | null) => (v == null ? '—' : fmt(v))

  if (!editing) {
    return (
      <tr className="border-t group">
        <td className="px-3 py-1.5 font-medium">
          <button onClick={openLp} className="text-left hover:underline hover:text-foreground">{pos.name}</button>
        </td>
        <td className="px-3 py-1.5 text-right font-mono">{cell(pos.commitment)}</td>
        <td className="px-3 py-1.5 text-right font-mono">{cell(pos.calledCapital)}</td>
        <td className="px-3 py-1.5 text-right font-mono">{cell(pos.distributions)}</td>
        <td className="px-3 py-1.5 text-right font-mono">{cell(pos.nav)}</td>
        <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{pctX(ratio(called, pos.commitment ?? 0))}</td>
        <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{moicX(ratio(dist, called))}</td>
        <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{moicX(ratio(nav, called))}</td>
        <td className="px-3 py-1.5 text-right font-mono">{moicX(ratio(dist + nav, called))}</td>
        <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{pctX(irr)}</td>
        {editable && (
          <td className="px-3 py-1.5 text-right">
            <button onClick={() => setEditing(true)} className="text-muted-foreground opacity-0 group-hover:opacity-100"><Pencil className="h-3.5 w-3.5" /></button>
          </td>
        )}
      </tr>
    )
  }
  const inp = (k: keyof typeof draft, w = 'w-28') => (
    <Input value={String(draft[k] ?? '')} onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} inputMode="decimal" className={`h-8 ${w} text-right font-mono ml-auto`} />
  )
  return (
    <tr className="border-t bg-muted/20">
      <td className="px-3 py-1.5 font-medium">{pos.name}</td>
      <td className="px-3 py-1.5">{inp('commitment')}</td>
      <td className="px-3 py-1.5">{inp('calledCapital')}</td>
      <td className="px-3 py-1.5">{inp('distributions')}</td>
      <td className="px-3 py-1.5">{inp('nav')}</td>
      <td colSpan={3} />
      <td className="px-3 py-1.5 text-right text-[11px] text-muted-foreground">derived</td>
      <td className="px-3 py-1.5">{inp('irr', 'w-20')}</td>
      <td className="px-3 py-1.5 text-right whitespace-nowrap">
        <button onClick={save} disabled={saving} className="text-green-600 mr-2">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : <Check className="h-3.5 w-3.5 inline" />}</button>
        <button onClick={() => setEditing(false)} className="text-muted-foreground"><X className="h-3.5 w-3.5 inline" /></button>
      </td>
    </tr>
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
              <th className="text-right px-3 py-2 font-medium">Called / paid-in</th>
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
        Paste a statement — the AI maps the columns (commitment, called/paid-in, distributions, NAV, and IRR if present).
        Each import is the cumulative position as of a date; re-importing a date replaces it. The table above and the
        roll-forward are derived from the dates you keep.
      </p>
      <label className="text-xs text-muted-foreground flex items-center gap-2">
        As of
        <Input type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)} className="h-9 w-40" />
      </label>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={8}
        placeholder="Paste spreadsheet rows (with headers): investor, commitment, called/paid-in, distributions, NAV, IRR…"
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
