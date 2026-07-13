'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Lock, Unlock, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'

interface Period { id: string; period_start: string; period_end: string; label: string | null; status: string; closed_at: string | null }
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
  readiness: Readiness
  warnings: string[]
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Common close-through dates. Any date works; these just save typing. */
function quickEnds(): { key: string; label: string; end: string }[] {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const q = Math.floor(m / 3)
  return [
    { key: 'last_month', label: 'End of last month', end: iso(new Date(Date.UTC(y, m, 0))) },
    { key: 'last_quarter', label: 'End of last quarter', end: iso(new Date(Date.UTC(y, q * 3, 0))) },
    { key: 'prior_year', label: 'End of prior year', end: `${y - 1}-12-31` },
  ]
}

export function PeriodsView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const [periods, setPeriods] = useState<Period[]>([])
  const [loading, setLoading] = useState(true)
  const [endDate, setEndDate] = useState(quickEnds()[0].end)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const lf = useLedgerFetch()

  const load = useCallback(() => {
    setLoading(true)
    lf('/api/accounting/periods').then(r => (r.ok ? r.json() : [])).then(d => setPeriods(Array.isArray(d) ? d : [])).finally(() => setLoading(false))
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
  const runPreview = () => previewThrough(endDate)

  async function confirmClose() {
    setBusy(true); setError(null)
    const { ok, data } = await post({ action: 'close', endDate })
    setBusy(false)
    if (!ok) { setError(data.error ?? 'Could not close'); return }
    setPreview(null)
    load()
  }

  async function reopen(id: string) {
    setBusy(true); setError(null)
    const { ok, data } = await post({ action: 'reopen', id })
    setBusy(false)
    if (!ok) { setError(data.error ?? 'Could not reopen'); return }
    load()
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="border rounded-lg p-4 space-y-3">
        <p className="text-sm font-medium">Close through a date</p>
        <p className="text-xs text-muted-foreground">
          You pick the end date; the start is wherever the last close left off, so no period can be
          skipped. The span is closed <strong>month by month</strong> — closing a quarter closes its three
          months — because the allocation basis is measured at each month end, and a commitment that
          changes mid-quarter would otherwise misallocate the earlier months.
        </p>

        <div className="flex flex-wrap gap-1.5">
          {quickEnds().map(q => (
            <button
              key={q.key}
              onClick={() => { setEndDate(q.end); setPreview(null) }}
              className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${q.end === endDate ? 'border-foreground/30 bg-accent font-medium' : 'border-border text-muted-foreground hover:text-foreground'}`}
            >
              {q.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted-foreground">Close through
            <input
              type="date"
              value={endDate}
              onChange={e => { setEndDate(e.target.value); setPreview(null) }}
              className="mt-1 block border rounded px-2 py-1.5 text-sm bg-transparent"
            />
          </label>
          <Button size="sm" variant="outline" onClick={runPreview} disabled={busy || !endDate}>
            {busy && !preview && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Preview close
          </Button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
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
              Split pro-rata by {preview.basis === 'capital_balance' ? 'capital-account balance' : 'commitment'} as of each month end.
              Nothing is posted until you confirm.
            </p>
          </div>

          {/* Blockers, not warnings: closing over unposted work silently strands its
              P&L, and the lock then prevents posting it into the period. */}
          {preview.readiness.blockers.map((b, i) => (
            <p key={`b${i}`} className="px-4 py-2 text-xs text-red-600 flex items-start gap-1.5 border-b bg-red-500/5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{b}
            </p>
          ))}

          {[...preview.readiness.warnings, ...preview.warnings].map((w, i) => (
            <p key={`w${i}`} className="px-4 py-2 text-xs text-amber-600 flex items-start gap-1.5 border-b">
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
                <span className="font-mono text-sm">{fmt(m.netIncome)}</span>
              </div>

              {m.categories.map(cat => (
                <div key={cat.sourceType} className="px-4 py-2 border-t">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">{cat.label}</span>
                    <span className="font-mono text-xs">{fmt(cat.capitalEffect)}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {cat.accounts.map(a => `${a.code} ${a.name}`).join(', ')} · {cat.lines.filter(l => l.amount !== 0).length} partners
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
      ) : periods.length === 0 ? (
        <p className="text-sm text-muted-foreground">No periods closed yet.</p>
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
              {periods.map(p => (
                <tr key={p.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2 font-mono text-xs">{p.period_start} → {p.period_end}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.label ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${p.status === 'closed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}>
                      {p.status === 'closed' ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}{p.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {p.status === 'closed' ? (
                      <button
                        onClick={() => reopen(p.id)}
                        disabled={busy}
                        title="Void this period's allocation entries and unlock it. Periods reopen newest-first."
                        className="text-xs text-muted-foreground hover:underline disabled:opacity-50"
                      >
                        Reopen &amp; reverse
                      </button>
                    ) : (
                      // Closing runs THROUGH a date, so this previews everything from the
                      // last close up to this period's end — which, for the oldest open
                      // period, is exactly this period alone.
                      <button
                        onClick={() => { setEndDate(p.period_end); setPreview(null); previewThrough(p.period_end) }}
                        disabled={busy}
                        title={`Preview closing through ${p.period_end}`}
                        className="text-xs text-muted-foreground hover:underline disabled:opacity-50"
                      >
                        Close through {p.period_end}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
