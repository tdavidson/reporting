'use client'

import { useEffect, useState } from 'react'
import { Loader2, FileText } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch, useVehicle } from '@/components/accounting-vehicle'
import { PERIOD_PRESETS, type PeriodPreset } from '@/lib/accounting/statement-period'

interface Row { lpEntityId: string; name: string; partnerClass: string; commitment: number; called: number; funded: number; outstanding: number; receivable: number; ending: number }
interface RollForward {
  beginning: number
  contributions: number
  distributions: number
  managementFees: number
  expenses: number
  operatingIncome: number
  realizedGains: number
  unrealizedGains: number
  transfers: number
  carriedInterest: number
  unclassified: number
  ending: number
}
interface Txn { date: string; memo: string | null; sourceType: string | null; amount: number; balance: number }
interface Period { preset: PeriodPreset; start: string | null; end: string | null; label: string }
interface Statement { row: Row; rollForward: RollForward; periodRollForward: RollForward; transactions: Txn[]; period: Period }

const ROLL: { key: keyof RollForward; label: string }[] = [
  { key: 'beginning', label: 'Beginning capital' },
  { key: 'contributions', label: 'Contributions' },
  { key: 'distributions', label: 'Distributions' },
  { key: 'managementFees', label: 'Management fees' },
  { key: 'expenses', label: 'Partnership expenses' },
  { key: 'operatingIncome', label: 'Operating income' },
  { key: 'realizedGains', label: 'Net realized gain / (loss)' },
  { key: 'unrealizedGains', label: 'Net unrealized gain / (loss)' },
  { key: 'transfers', label: 'Transfers' },
  { key: 'carriedInterest', label: 'Carried interest accrued' },
  { key: 'unclassified', label: 'Unclassified' },
  { key: 'ending', label: 'Ending capital (NAV)' },
]

export function LpStatementView({ lpEntityId }: { lpEntityId: string }) {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const lf = useLedgerFetch()
  const { group } = useVehicle()
  const [data, setData] = useState<Statement | null>(null)
  const [loading, setLoading] = useState(true)
  const [preset, setPreset] = useState<PeriodPreset>('ytd')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [classBusy, setClassBusy] = useState(false)
  const [classError, setClassError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    const qs = new URLSearchParams({ lp: lpEntityId, preset })
    if (preset === 'custom') {
      if (start) qs.set('start', start)
      if (end) qs.set('end', end)
    }
    lf(`/api/accounting/lp-statement?${qs}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => setData(d && !d.error ? d : null))
      .finally(() => setLoading(false))
  }, [lf, lpEntityId, preset, start, end])

  async function switchPartnerClass(next: 'lp' | 'gp') {
    if (!data || next === data.row.partnerClass) return
    if (!window.confirm('Change this partner to GP/LP? This updates fee & carry participation and how the close allocates to them.')) return
    setClassBusy(true)
    setClassError(null)
    const res = await lf('/api/accounting/lps', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId: lpEntityId, partnerClass: next }),
    })
    setClassBusy(false)
    if (!res.ok) {
      setClassError((await res.json().catch(() => ({}))).error ?? 'Could not change partner class')
      return
    }
    // Re-run the loader by flipping partnerClass locally, then refetch the full statement so
    // fee/carry-dependent figures (roll-forward, cards) reflect the switch immediately.
    setData(d => (d ? { ...d, row: { ...d.row, partnerClass: next } } : d))
    setLoading(true)
    const qs = new URLSearchParams({ lp: lpEntityId, preset })
    if (preset === 'custom') { if (start) qs.set('start', start); if (end) qs.set('end', end) }
    lf(`/api/accounting/lp-statement?${qs}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => setData(d && !d.error ? d : null))
      .finally(() => setLoading(false))
  }

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
  if (!data) return <div className="border border-dashed rounded-lg p-8 text-center text-sm text-muted-foreground">No statement for this LP in the selected vehicle.</div>

  const { row, rollForward, periodRollForward, transactions, period } = data
  const pdfQs = new URLSearchParams({ lp: lpEntityId })
  if (group) pdfQs.set('group', group)
  if (preset === 'custom') { if (start) pdfQs.set('start', start); if (end) pdfQs.set('end', end) }
  else pdfQs.set('preset', preset)
  const statementPdfUrl = `/api/accounting/lp-statement/pdf?${pdfQs}`
  // Hide a line only when it's zero in BOTH columns — a line that's zero this period
  // but non-zero since inception still belongs on the statement.
  const lines = ROLL.filter(l =>
    l.key === 'beginning' || l.key === 'ending' ||
    Math.abs(rollForward[l.key]) > 0.004 || Math.abs(periodRollForward[l.key]) > 0.004
  )
  const cards: { label: string; value: number }[] = [
    { label: 'Commitment', value: row.commitment },
    { label: 'Called', value: row.called },
    { label: 'Funded', value: row.funded },
    { label: 'Remaining to be called', value: row.outstanding },
    { label: 'Unfunded call', value: row.receivable },
    { label: 'Ending NAV', value: row.ending },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-medium">{row.name}{row.partnerClass === 'gp' && <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground align-middle">GP</span>}</h2>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Type
            <select
              value={row.partnerClass === 'gp' ? 'gp' : 'lp'}
              disabled={classBusy}
              onChange={e => switchPartnerClass(e.target.value as 'lp' | 'gp')}
              className="h-7 px-1.5 rounded-md border border-input bg-background text-xs disabled:opacity-50"
            >
              <option value="lp">LP</option>
              <option value="gp">GP</option>
            </select>
          </label>
        </div>
        {/* Preview only — renders the PDF without storing or sharing it. Publishing
            to the portal is the bulk action on the capital accounts page. */}
        <a
          href={statementPdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded border border-input px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <FileText className="h-3.5 w-3.5" />Generate PDF
        </a>
      </div>
      {classError && <p className="text-xs text-red-600">{classError}</p>}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {cards.map(c => (
          <div key={c.label} className="border rounded-lg p-3">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className="text-lg font-mono font-semibold mt-0.5">{fmt(c.value)}</p>
          </div>
        ))}
      </div>

      <div>
        <div className="flex flex-wrap items-end justify-between gap-3 mb-2">
          <p className="text-sm font-medium">Capital roll-forward</p>
          <div className="flex flex-wrap items-end gap-2">
            <select
              value={preset}
              onChange={e => setPreset(e.target.value as PeriodPreset)}
              className="h-8 px-2 rounded-md border border-input bg-background text-xs"
            >
              {PERIOD_PRESETS.filter(p => p.value !== 'itd').map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            {preset === 'custom' && (
              <>
                <Input type="date" value={start} onChange={e => setStart(e.target.value)} className="h-8 w-36 text-xs" />
                <Input type="date" value={end} onChange={e => setEnd(e.target.value)} className="h-8 w-36 text-xs" />
              </>
            )}
          </div>
        </div>
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-xs">
                <th className="text-left px-3 py-2 font-medium" />
                <th className="text-right px-3 py-2 font-medium">Statement period<div className="font-normal text-muted-foreground">{period?.label}</div></th>
                <th className="text-right px-3 py-2 font-medium">Inception to date</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(r => (
                <tr key={r.key} className={`border-b last:border-b-0 ${r.key === 'ending' ? 'font-semibold bg-muted/30' : ''}`}>
                  <td className="px-3 py-2">{r.label}</td>
                  <td className={`px-3 py-2 text-right font-mono ${r.key === 'unclassified' && Math.abs(periodRollForward[r.key]) > 0.004 ? 'text-amber-600' : ''}`}>{fmt(periodRollForward[r.key])}</td>
                  <td className={`px-3 py-2 text-right font-mono ${r.key === 'unclassified' && Math.abs(rollForward[r.key]) > 0.004 ? 'text-amber-600' : ''}`}>{fmt(rollForward[r.key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Transactions</p>
        {transactions.length === 0 ? (
          <div className="border border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground">No capital movements yet.</div>
        ) : (
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-3 py-2 font-medium">Date</th>
                  <th className="text-left px-3 py-2 font-medium">Description</th>
                  <th className="text-left px-3 py-2 font-medium">Type</th>
                  <th className="text-right px-3 py-2 font-medium">Amount</th>
                  <th className="text-right px-3 py-2 font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t, i) => (
                  <tr key={i} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{t.date}</td>
                    <td className="px-3 py-2">{t.memo ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{t.sourceType ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(t.amount)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(t.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
