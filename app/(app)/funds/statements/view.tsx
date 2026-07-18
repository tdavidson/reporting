'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Download } from 'lucide-react'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch, useVehicle, useFundSeg } from '@/components/accounting-vehicle'
import { PERIOD_PRESETS, type PeriodPreset } from '@/lib/accounting/statement-period'

interface Section { label: string; rows: { code: string; name: string; amount: number }[]; total: number }
interface PartnerRow {
  id: string
  name: string
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
interface CFSection { label: string; lines: { code: string; name: string; amount: number }[]; total: number }
interface Period { preset: PeriodPreset; start: string | null; end: string | null; label: string }
interface Data {
  period: Period
  trialBalance: { rows: { code: string; name: string; debit: number; credit: number }[]; totalDebits: number; totalCredits: number; balanced: boolean }
  balanceSheet: {
    assets: Section
    liabilities: Section
    equity: Section
    check: number
    partnersCapital: { total: number; unallocatedEarnings: number }
  }
  incomeStatement: { income: Section; expenses: Section; netIncome: number }
  changesInPartnersCapital: { partners: PartnerRow[]; totals: PartnerRow }
  cashFlows: {
    operating: CFSection
    financing: CFSection
    netChange: number
    openingCash: number
    endingCash: number
    nonCash: { entryId: string; date: string | null; description: string; amount: number; legs: { name: string; amount: number }[] }[]
  } | null
}

const CAP_COLS: { key: keyof PartnerRow; label: string }[] = [
  { key: 'beginning', label: 'Beginning' },
  { key: 'contributions', label: 'Contributions' },
  { key: 'distributions', label: 'Distributions' },
  { key: 'managementFees', label: 'Mgmt fees' },
  { key: 'expenses', label: 'Partnership exp.' },
  { key: 'operatingIncome', label: 'Operating income' },
  { key: 'realizedGains', label: 'Net realized G/(L)' },
  { key: 'unrealizedGains', label: 'Net unrealized G/(L)' },
  { key: 'transfers', label: 'Transfers' },
  { key: 'carriedInterest', label: 'Carry accrued' },
  { key: 'unclassified', label: 'Unclassified' },
  { key: 'ending', label: 'Ending' },
]

export function StatementsView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [preset, setPreset] = useState<PeriodPreset>('ytd')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const lf = useLedgerFetch()
  const { group } = useVehicle()
  const fundSeg = useFundSeg()

  // Same period params as the on-screen fetch, plus the selected vehicle — the export
  // route computes the identical package and serializes it to a multi-tab .xlsx.
  const exportQs = new URLSearchParams({ preset })
  if (preset === 'custom') {
    if (start) exportQs.set('start', start)
    if (end) exportQs.set('end', end)
  }
  if (group) exportQs.set('group', group)
  const exportUrl = `/api/accounting/statements/export?${exportQs}`
  const canExport = !loading && !!data && data.trialBalance.rows.length > 0

  useEffect(() => {
    setLoading(true)
    const qs = new URLSearchParams({ preset })
    if (preset === 'custom') {
      if (start) qs.set('start', start)
      if (end) qs.set('end', end)
    }
    lf(`/api/accounting/statements?${qs}`)
      .then(r => (r.ok ? r.json() : null))
      .then(setData)
      .finally(() => setLoading(false))
  }, [lf, preset, start, end])

  const period = data?.period
  // A balance sheet is a snapshot; an income statement and cash flows cover a span.
  const asOfLabel = period?.end ? `as of ${period.end}` : 'as of today'
  const overLabel = period?.preset === 'itd'
    ? 'since inception'
    : period?.start && period?.end ? `for ${period.label}` : period?.label ?? ''

  // A section with no detail rows (partners' capital) renders as a single total line.
  const Sec = ({ s }: { s: Section }) => (
    <>
      {s.rows.length > 0 && (
        <tr className="border-t bg-muted/30"><td className="px-3 py-1.5 font-medium" colSpan={2}>{s.label}</td></tr>
      )}
      {s.rows.map(r => (
        <tr key={r.code || r.name} className="border-t">
          <td className="px-3 py-1.5 text-muted-foreground">{r.code ? `${r.code} · ` : ''}{r.name}</td>
          <td className="px-3 py-1.5 text-right font-mono">{fmt(r.amount)}</td>
        </tr>
      ))}
      <tr className="border-t font-semibold">
        <td className="px-3 py-1.5">Total {s.label}</td>
        <td className="px-3 py-1.5 text-right font-mono">{fmt(s.total)}</td>
      </tr>
    </>
  )

  // Coded like every other statement — `1000 · Cash` — rather than a bare name.
  const CFSec = ({ sec }: { sec: CFSection }) => (
    <>
      <tr className="border-t bg-muted/30"><td className="px-3 py-1.5 font-medium" colSpan={2}>{sec.label}</td></tr>
      {sec.lines.map(l => (
        <tr key={`${l.code}|${l.name}`} className="border-t">
          <td className="px-3 py-1.5 text-muted-foreground">{l.code} · {l.name}</td>
          <td className="px-3 py-1.5 text-right font-mono">{fmt(l.amount)}</td>
        </tr>
      ))}
      <tr className="border-t font-semibold"><td className="px-3 py-1.5">Total {sec.label}</td><td className="px-3 py-1.5 text-right font-mono">{fmt(sec.total)}</td></tr>
    </>
  )

  return (
    <div className="space-y-4">
      {/* Action bar — export on the LEFT, the statement-period select (and custom from/to)
          pushed RIGHT via ml-auto, matching /funds/capital-accounts. Each statement's subheader
          below already states its as-of / covering dates, so there is no explainer line here. */}
      <div className="flex flex-wrap items-center gap-2">
        {canExport ? (
          <a
            href={exportUrl}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-input bg-background text-sm hover:bg-muted"
          >
            <Download className="h-4 w-4" />Export workpapers (Excel)
          </a>
        ) : (
          <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-input text-sm text-muted-foreground opacity-50">
            <Download className="h-4 w-4" />Export workpapers (Excel)
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {preset === 'custom' && (
            <>
              <input type="date" value={start} onChange={e => setStart(e.target.value)} aria-label="From" className="h-9 w-36 px-2 rounded-md border border-input bg-transparent text-sm" />
              <input type="date" value={end} onChange={e => setEnd(e.target.value)} aria-label="To" className="h-9 w-36 px-2 rounded-md border border-input bg-transparent text-sm" />
            </>
          )}
          <select
            value={preset}
            onChange={e => setPreset(e.target.value as PeriodPreset)}
            aria-label="Statement period"
            className="h-9 px-3 rounded-md border border-input bg-background text-sm"
          >
            {PERIOD_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
      ) : !data || data.trialBalance.rows.length === 0 ? (
        <div className="border border-dashed rounded-lg p-8 text-center text-sm text-muted-foreground">No statements yet — the ledger has no posted entries{period?.end ? ` as of ${period.end}` : ''}.</div>
      ) : (
    // ASC 946 order: assets & liabilities, then operations, then cash flows, then
    // changes in partners' capital last — the per-partner detail behind the single
    // capital line on the balance sheet.
    <div className="space-y-8">
      <section>
        <h2 className="text-sm font-semibold">Statement of assets, liabilities and partners&rsquo; capital</h2>
        <p className="text-xs text-muted-foreground mb-2">Balance sheet — {asOfLabel}</p>
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              <Sec s={data.balanceSheet.assets} />
              <Sec s={data.balanceSheet.liabilities} />
              <Sec s={data.balanceSheet.equity} />
            </tbody>
          </table>
        </div>
        {/* Only worth saying when it's actionable: unallocated earnings mean the
            per-LP capital accounts understate until the period is closed. */}
        {data.balanceSheet.partnersCapital.unallocatedEarnings !== 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            {fmt(data.balanceSheet.partnersCapital.unallocatedEarnings)} of net income is not yet allocated to partners.
            Close the period to allocate it — until then each partner&rsquo;s capital account understates their NAV.
          </p>
        )}
        {data.balanceSheet.check !== 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            Does not balance — residual {fmt(data.balanceSheet.check)}.
          </p>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold">Statement of operations</h2>
        <p className="text-xs text-muted-foreground mb-2">Income statement — {overLabel}</p>
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              <Sec s={data.incomeStatement.income} />
              <Sec s={data.incomeStatement.expenses} />
              <tr className="border-t font-semibold bg-muted/30">
                <td className="px-3 py-1.5">Net income</td>
                <td className="px-3 py-1.5 text-right font-mono">{fmt(data.incomeStatement.netIncome)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {/* A balanced trial balance is the expected state — only worth saying when it isn't. */}
        {!data.trialBalance.balanced && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            Trial balance is out of balance — debits {fmt(data.trialBalance.totalDebits)} vs credits {fmt(data.trialBalance.totalCredits)}.
          </p>
        )}
      </section>

      {data.cashFlows && (
        <section>
          <h2 className="text-sm font-semibold">Statement of cash flows</h2>
          <p className="text-xs text-muted-foreground mb-2">{overLabel}</p>
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                <CFSec sec={data.cashFlows.operating} />
                <CFSec sec={data.cashFlows.financing} />
                <tr className="border-t font-semibold bg-muted/30">
                  <td className="px-3 py-1.5">Net change in cash</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmt(data.cashFlows.netChange)}</td>
                </tr>
                <tr className="border-t">
                  <td className="px-3 py-1.5 text-muted-foreground">Ending cash</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmt(data.cashFlows.endingCash)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Required by ASC 230: investing/financing that bypassed the bank account.
              Without it, a loan the lender paid straight to the company looks like a
              repayment of money that was never borrowed. */}
          {data.cashFlows.nonCash.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-medium">Supplemental — non-cash investing and financing activities</h3>
              <p className="text-xs text-muted-foreground mb-2">
                Transactions that changed investments, borrowings, or partners&rsquo; capital without moving cash,
                so they do not appear above.
              </p>
              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {data.cashFlows.nonCash.map(n => (
                      <tr key={n.entryId} className="border-t first:border-t-0">
                        <td className="px-3 py-1.5">
                          <span className="font-mono text-xs text-muted-foreground mr-2">{n.date}</span>
                          {n.description}
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {n.legs.map(l => `${l.amount > 0 ? 'Dr' : 'Cr'} ${l.name}`).join(' · ')}
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono align-top whitespace-nowrap">{fmt(n.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold">Statement of changes in partners&rsquo; capital</h2>
        <p className="text-xs text-muted-foreground mb-2">
          {overLabel} — beginning capital is the balance carried into the period; this is the detail behind the
          single partners&rsquo; capital line on the balance sheet
        </p>
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-3 py-2 font-medium">Partner</th>
                {CAP_COLS.map(c => <th key={c.key} className="text-right px-3 py-2 font-medium">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.changesInPartnersCapital.partners.map(p => (
                <tr key={p.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  {/* p.id is the lpEntityId — link through to that partner's capital
                      account. The synthetic GP row has no entity to link to. */}
                  <td className="px-3 py-2">
                    {p.id === 'gp'
                      ? p.name
                      : <Link href={fundSeg ? `/funds/${fundSeg}/capital-accounts/${p.id}` : '/funds'} className="hover:underline">{p.name}</Link>}
                  </td>
                  {CAP_COLS.map(c => <td key={c.key} className={`px-3 py-2 text-right font-mono ${c.key === 'ending' ? 'font-semibold' : ''}`}>{fmt(p[c.key] as number)}</td>)}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/30 font-semibold">
                <td className="px-3 py-2">Total</td>
                {CAP_COLS.map(c => <td key={c.key} className="px-3 py-2 text-right font-mono">{fmt(data.changesInPartnersCapital.totals[c.key] as number)}</td>)}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
      )}
    </div>
  )
}
