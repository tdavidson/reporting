'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { Loader2, Lock, Unlock, AlertTriangle, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'
import { NoBooksState, useChartExists } from '@/components/accounting/no-books'

interface Period { id: string; period_start: string; period_end: string; label: string | null; status: string; closed_at: string | null }
interface CloseEntryLine { accountCode: string; accountName: string; lpName: string | null; amount: number }
interface CloseEntry { id: string; entryDate: string; memo: string | null; sourceType: string | null; lines: CloseEntryLine[] }
interface CloseLine { lpEntityId: string; name: string; amount: number }
interface CloseCategory {
  sourceType: string
  label: string
  capitalEffect: number
  accounts: { code: string; name: string; amount: number }[]
  lines: CloseLine[]
}
interface MonthPreview {
  periodStart: string
  periodEnd: string
  netIncome: number
  categories: CloseCategory[]
  warnings: string[]
}
interface Readiness {
  draftEntries: { count: number; earliest: string | null }
  unpostedBankTxns: { count: number; total: number }
  blockers: string[]
  warnings: string[]
}
interface Preview {
  start: string
  end: string
  months: MonthPreview[]
  totalNetIncome: number
  basis: string
  /** 'owner' for a management company or an individual: net income to one equity account, no split. */
  mode?: 'partners' | 'owner'
  readiness: Readiness
  warnings: string[]
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/**
 * The months still open, derived: from where the next close would start through the end
 * of last month. A month in progress isn't offered — its books aren't finished. These rows
 * are never stored; a fiscal_periods row only exists once a month has been closed.
 */
function openMonths(nextStart: string | null): { period_start: string; period_end: string }[] {
  if (!nextStart) return []
  const now = new Date()
  const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
  const out: { period_start: string; period_end: string }[] = []
  let cursor = new Date(`${nextStart}T00:00:00Z`)
  while (true) {
    const y = cursor.getUTCFullYear(), m = cursor.getUTCMonth()
    const end = new Date(Date.UTC(y, m + 1, 0))
    if (end > lastMonthEnd) break
    out.push({ period_start: iso(cursor), period_end: iso(end) })
    cursor = new Date(Date.UTC(y, m + 1, 1))
  }
  return out
}

export function PeriodsView() {
  const hasChart = useChartExists()
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const [periods, setPeriods] = useState<Period[]>([])
  const [loading, setLoading] = useState(true)
  const [endDate, setEndDate] = useState('')
  const [nextStart, setNextStart] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  // Which closed period's allocated transactions are expanded, and their (cached) entries.
  const [openId, setOpenId] = useState<string | null>(null)
  const [entriesById, setEntriesById] = useState<Record<string, CloseEntry[] | 'loading'>>({})
  const lf = useLedgerFetch()

  const load = useCallback(() => {
    setLoading(true)
    lf('/api/accounting/periods').then(r => (r.ok ? r.json() : null)).then(d => {
      setPeriods(Array.isArray(d?.periods) ? d.periods : [])
      setNextStart(d?.nextStart ?? null)
    }).finally(() => setLoading(false))
  }, [lf])
  useEffect(() => { load() }, [load])

  const post = async (body: object) => {
    const res = await lf('/api/accounting/periods', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    return { ok: res.ok, data: await res.json() }
  }

  async function previewThrough(through: string) {
    setBusy(true); setError(null); setPreview(null)
    const { ok, data } = await post({ action: 'preview', endDate: through })
    setBusy(false)
    if (!ok) { setError(data.error ?? 'Could not preview'); return }
    setPreview(data)
  }

  async function confirmClose() {
    setBusy(true); setError(null)
    const { ok, data } = await post({ action: 'close', endDate })
    setBusy(false)
    if (!ok) { setError(data.error ?? 'Could not close'); return }
    setPreview(null)
    load()
  }

  // Expand a closed period to show the transactions its close posted (fetched once, then cached).
  async function toggleEntries(id: string) {
    if (openId === id) { setOpenId(null); return }
    setOpenId(id)
    if (!entriesById[id]) {
      setEntriesById(s => ({ ...s, [id]: 'loading' }))
      const res = await lf(`/api/accounting/periods?entriesFor=${id}`)
      const data = res.ok ? await res.json() : []
      setEntriesById(s => ({ ...s, [id]: Array.isArray(data) ? data : [] }))
    }
  }

  // Periods reopen newest-first, and the server cascades: reopening a period reopens every
  // closed period after it too. Say how many BEFORE doing it — two years of months is a lot
  // to unwind on one click without warning.
  const [confirmReopen, setConfirmReopen] = useState<string | null>(null)
  const laterClosed = (id: string) => {
    const target = periods.find(p => p.id === id)
    if (!target) return []
    return periods.filter(p => p.status === 'closed' && p.period_start > target.period_start)
  }

  async function reopen(id: string) {
    setBusy(true); setError(null); setConfirmReopen(null)
    const { ok, data } = await post({ action: 'reopen', id })
    setBusy(false)
    if (!ok) { setError(data.error ?? 'Could not reopen'); return }
    load()
  }

  // One list: stored rows (closed, plus any left open by a reopen) and the derived open
  // months, newest first. A stored row wins over a derived one for the same month.
  const rows: Period[] = [
    ...periods,
    ...openMonths(nextStart)
      .filter(m => !periods.some(p => p.period_start <= m.period_end && p.period_end >= m.period_start))
      .map(m => ({ id: `open:${m.period_start}`, ...m, label: null, status: 'open', closed_at: null })),
  ].sort((a, b) => (a.period_end < b.period_end ? 1 : -1))

  // A close allocates the ledger's income to partners; with no chart there is no ledger to close.
  if (hasChart === false) {
    return <NoBooksState>No accounts are set up for this entity yet, so there is nothing to close.</NoBooksState>
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="space-y-1">
        <p className="text-sm font-medium">Periods</p>
        <p className="text-xs text-muted-foreground">
          Each month is closed in order and locked: preview a month to see what its close would allocate, then confirm.
          Reopening a month reverses its allocation and reopens every month after it.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {/* Nothing is posted until this is approved. */}
      {preview && (
        <div className="border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30">
            <p className="text-sm font-medium">
              Closing {preview.start} → {preview.end} will allocate {fmt(preview.totalNetIncome)} of net income
              across {preview.months.length} month{preview.months.length === 1 ? '' : 's'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {preview.mode === 'owner'
                ? 'Rolled into the owner’s capital account — no partners, nothing to split.'
                : `Split pro-rata by ${preview.basis === 'capital_balance' ? 'capital-account balance' : 'commitment'} as of each month end.`}
              {' '}Nothing is posted until you confirm.
            </p>
          </div>

          {/* Blockers, not warnings: closing over unposted work silently strands its
              P&L, and the lock then prevents posting it into the period. */}
          {preview.readiness.blockers.map((b, i) => (
            <p key={`b${i}`} className="px-4 py-2 text-sm text-destructive flex items-start gap-1.5 border-b bg-destructive/5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{b}
            </p>
          ))}

          {[...preview.readiness.warnings, ...preview.warnings].map((w, i) => (
            <p key={`w${i}`} className="px-4 py-2 text-sm text-warning flex items-start gap-1.5 border-b">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{w}
            </p>
          ))}

          {preview.months.map(m => (
            <div key={m.periodStart} className="border-b last:border-b-0">
              <div className="px-4 py-2 flex items-center justify-between bg-muted/20">
                <span className="text-sm font-medium">
                  {m.periodStart} → {m.periodEnd}
                  {m.categories.length === 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">no activity</span>}
                </span>
                <span className="tabular-nums text-sm">{fmt(m.netIncome)}</span>
              </div>

              {m.categories.map(cat => (
                <div key={cat.sourceType} className="px-4 py-2 border-t">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">{cat.label}</span>
                    <span className="tabular-nums text-xs">{fmt(cat.capitalEffect)}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {cat.accounts.map(a => `${a.code} ${a.name}`).join(', ')} · {preview.mode === 'owner' ? 'to the owner’s capital' : `${cat.lines.filter(l => l.amount !== 0).length} partners`}
                  </p>
                </div>
              ))}
            </div>
          ))}

          <div className="px-4 py-3 flex items-center gap-2 border-t bg-muted/30">
            <Button size="sm" onClick={confirmClose} disabled={busy || preview.readiness.blockers.length > 0}>
              {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}<Lock className="h-3.5 w-3.5 mr-1" />Close &amp; lock
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPreview(null)} disabled={busy}>Cancel</Button>
            {preview.readiness.blockers.length > 0 && (
              <span className="text-xs text-muted-foreground">Resolve the items above before closing.</span>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing to close yet — the ledger has no posted entries in a finished month.</p>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-3 py-2 font-medium">Period</th>
                <th className="text-left px-3 py-2 font-medium">Label</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map(p => {
                const isClosed = p.status === 'closed'
                const open = openId === p.id
                const entries = entriesById[p.id]
                return (
                  <Fragment key={p.id}>
                    <tr
                      className={`border-b ${open ? '' : 'last:border-b-0'} ${isClosed ? 'cursor-pointer hover:bg-muted/20' : ''}`}
                      onClick={isClosed ? () => toggleEntries(p.id) : undefined}
                    >
                      <td className="px-3 py-2 tabular-nums text-xs">
                        <span className="flex items-center gap-1.5">
                          {/* Closed periods expand to show the transactions the close posted. */}
                          {isClosed
                            ? <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
                            : <span className="w-3.5 shrink-0" />}
                          {p.period_start} → {p.period_end}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{p.label ?? '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${isClosed ? 'bg-success-subtle text-success dark:bg-success-subtle/30 dark:text-success' : 'bg-muted text-muted-foreground'}`}>
                          {isClosed ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}{p.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isClosed ? (
                          confirmReopen === p.id ? (
                            <span className="inline-flex items-center gap-2 text-xs" onClick={e => e.stopPropagation()}>
                              <span className="text-warning">
                                Also reopens the {laterClosed(p.id).length} later {laterClosed(p.id).length === 1 ? 'period' : 'periods'} — each one&rsquo;s allocation is reversed.
                              </span>
                              <button onClick={() => reopen(p.id)} disabled={busy} className="font-medium hover:underline disabled:opacity-50">Reopen all</button>
                              <button onClick={() => setConfirmReopen(null)} disabled={busy} className="text-muted-foreground hover:underline disabled:opacity-50">Cancel</button>
                            </span>
                          ) : (
                            <button
                              onClick={e => { e.stopPropagation(); laterClosed(p.id).length > 0 ? setConfirmReopen(p.id) : reopen(p.id) }}
                              disabled={busy}
                              title={laterClosed(p.id).length > 0
                                ? `Reopens this period and the ${laterClosed(p.id).length} closed after it, newest-first, reversing each allocation.`
                                : "Void this period's allocation entries and unlock it."}
                              className="text-xs text-muted-foreground hover:underline disabled:opacity-50"
                            >
                              Reopen
                            </button>
                          )
                        ) : (
                          // Closing runs THROUGH a date, so this previews everything from the
                          // last close up to this period's end — which, for the oldest open
                          // period, is exactly this period alone.
                          <button
                            onClick={e => { e.stopPropagation(); setEndDate(p.period_end); setPreview(null); previewThrough(p.period_end) }}
                            disabled={busy}
                            title={`Preview closing through ${p.period_end}`}
                            className="text-xs text-muted-foreground hover:underline disabled:opacity-50"
                          >
                            Preview close
                          </button>
                        )}
                      </td>
                    </tr>

                    {isClosed && open && (
                      <tr className="border-b last:border-b-0 bg-muted/10">
                        <td colSpan={4} className="px-3 py-2.5">
                          {entries === undefined || entries === 'loading' ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading transactions…</div>
                          ) : entries.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No allocation transactions were posted for this period (nothing to allocate).</p>
                          ) : (
                            <div className="space-y-2">
                              <p className="text-[11px] text-muted-foreground">The transactions this close posted — the same allocation the preview showed, read back from the ledger.</p>
                              {entries.map(en => (
                                <div key={en.id} className="rounded border bg-background overflow-hidden">
                                  <div className="flex items-center justify-between px-2.5 py-1.5 border-b bg-muted/30">
                                    <span className="text-xs font-medium">{en.memo ?? en.sourceType ?? 'Transaction'}</span>
                                    <span className="text-[11px] text-muted-foreground tabular-nums">{en.entryDate}</span>
                                  </div>
                                  <table className="w-full text-xs">
                                    <tbody>
                                      {en.lines.map((l, i) => (
                                        <tr key={i} className="border-t first:border-t-0">
                                          <td className="px-2.5 py-1 text-muted-foreground whitespace-nowrap">{[l.accountCode, l.accountName].filter(Boolean).join(' ')}</td>
                                          <td className="px-2.5 py-1">{l.lpName ?? ''}</td>
                                          <td className="px-2.5 py-1 text-right tabular-nums">{fmt(l.amount)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
