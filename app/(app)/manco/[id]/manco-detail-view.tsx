'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts'
import { Loader2, ArrowRight, BookOpen, Landmark, FileText, Lock, Upload, Table2 } from 'lucide-react'
import { useCurrency, formatCurrency, formatCurrencyFull } from '@/components/currency-context'
import { AccountingBody } from '@/components/accounting-chrome'
import { AnalystToggleButton } from '@/components/analyst-button'
import { Card, CardContent } from '@/components/ui/card'
import { Metric as MetricBox } from '@/components/ui/metric'
import { ChartCard, EmptyPlot, AXIS, tooltipStyle, HUE } from '@/components/fund-chart-kit'
import { IntercompanyPanel } from './intercompany-panel'

// The management company dashboard. Everything here is READ-ONLY and derived from the manco's own
// ledger — see lib/accounting/manco-overview.ts for what each figure means and why.
//
// The one thing that isn't read-only is the intercompany panel, which posts both sides of a charge;
// it lives in its own file because it is a form with its own state, not a number.

interface QuarterCycle {
  key: string; label: string; year: number; quarter: number
  revenue: number; expenses: number; net: number
}
interface ExpenseLine { code: string; name: string; amount: number; share: number | null }
interface Balance {
  counterpartyVehicleId: string; counterpartyName: string
  dueFrom: number; dueTo: number; net: number
}
interface Charge {
  id: string; kind: string; chargeDate: string; amount: number; memo: string | null
  status: 'accrued' | 'settled' | 'void'; settledDate: string | null
  direction: 'receivable' | 'payable'; counterpartyVehicleId: string
}
interface Overview {
  vehicle: string
  vehicleId: string | null
  cash: number
  cashAccounts: { code: string; name: string; balance: number }[]
  revenue: number
  expenses: number
  net: number
  quarters: QuarterCycle[]
  expenseLines: ExpenseLine[]
  monthlyBurn: number | null
  runwayMonths: number | null
  hasLedger: boolean
  window: { start: string; end: string }
  intercompany: { balances: Balance[]; charges: Charge[] }
}

// Revenue and expenses are the two series on the quarterly chart, and they are compared to each
// other rather than summed — so they take two distinct categorical slots, not two shades of one.
// Net rides on top as a line, in ink, because it is a different QUANTITY, not a third category.
const REVENUE_HUE = HUE.chart1
const EXPENSE_HUE = HUE.chart4

export function MancoDetailView({
  vehicle, vehicleId, active,
}: {
  vehicle: string
  vehicleId: string
  active: boolean
}) {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrency(v, currency)
  const fmtFull = (v: number) => formatCurrencyFull(v, currency)

  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/manco/overview?group=${encodeURIComponent(vehicle)}`)
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Could not load')
        return r.json()
      })
      .then(d => { setData(d); setError(null) })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [vehicle])
  useEffect(() => { load() }, [load])

  const chartData = useMemo(
    () => (data?.quarters ?? []).map(q => ({ ...q, name: q.label })),
    [data?.quarters],
  )

  return (
    <>
      <div className="flex items-end justify-between gap-3 mb-6">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight truncate">{vehicle}</h1>
            {!active && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">
                Inactive
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Management company &mdash; cash, the quarterly fee cycle, operating costs, and
            intercompany balances with the funds.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <AnalystToggleButton />
        </div>
      </div>

      <AccountingBody>
        {loading && !data ? (
          <div className="rounded-card border p-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the management company&rsquo;s books…
          </div>
        ) : error ? (
          <div className="rounded-card border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : !data ? null : (
          <div className="space-y-4">
            {!data.hasLedger && (
              <div className="rounded-card border bg-muted/40 p-4 text-sm">
                <p className="font-medium">No entries yet.</p>
                <p className="mt-1 text-muted-foreground">
                  The chart of accounts is set up. Import the QuickBooks general ledger, or start
                  posting journal entries, and this page fills in.
                </p>
              </div>
            )}

            {/* 1. HOW MUCH CASH IS THERE. */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricBox
                label="Cash"
                value={fmt(data.cash)}
                sub={
                  data.cashAccounts.length > 1
                    ? data.cashAccounts.map(a => `${a.name}: ${fmtFull(a.balance)}`).join(' · ')
                    : fmtFull(data.cash)
                }
              />
              <MetricBox
                label="Monthly burn"
                value={data.monthlyBurn == null ? '—' : fmt(data.monthlyBurn)}
                sub={
                  data.monthlyBurn == null
                    ? 'Not enough history, or no cash expenses yet'
                    : 'Cash expenses only — depreciation excluded'
                }
              />
              <MetricBox
                label="Runway"
                value={data.runwayMonths == null ? '—' : `${data.runwayMonths} mo`}
                sub={data.runwayMonths == null ? 'Not burning cash' : 'At the current burn rate'}
              />
              <MetricBox
                label="Operating result"
                value={fmt(data.net)}
                sub={`${fmtFull(data.revenue)} revenue · ${fmtFull(data.expenses)} expenses`}
              />
            </div>

            {/* 2. WHAT CAME IN AND WENT OUT, BY QUARTER. */}
            <ChartCard title="Revenue and expenses by quarter">
              {chartData.length === 0 ? (
                <EmptyPlot label="No income or expenses in this window" />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="name" tick={AXIS} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={AXIS} stroke="hsl(var(--muted-foreground))" tickFormatter={v => fmt(Number(v))} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v: any, n: any) => [fmtFull(Number(v)), n]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {/* Zero is where a quarter turns from profit to loss, so it gets a rule rather
                        than being left for the reader to find among the gridlines. */}
                    <ReferenceLine y={0} stroke="hsl(var(--border))" />
                    <Bar dataKey="revenue" name="Revenue" fill={REVENUE_HUE} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="expenses" name="Expenses" fill={EXPENSE_HUE} radius={[2, 2, 0, 0]} />
                    <Line
                      type="monotone" dataKey="net" name="Net"
                      stroke={HUE.ink} strokeWidth={1.5} dot={{ r: 2 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
              <p className="mt-2 text-caption text-muted-foreground">
                Quarters with no activity are shown as gaps rather than skipped &mdash; a fee that
                never arrived should look like a hole, not a flat line.
              </p>
            </ChartCard>

            {/* 3. WHERE THE MONEY GOES. */}
            <Card>
              <CardContent className="pt-4 pb-4 px-4">
                <p className="text-sm font-medium mb-3">Expenses</p>
                {data.expenseLines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No expenses booked in this window.</p>
                ) : (
                  <div className="space-y-2">
                    {data.expenseLines.map(l => (
                      <div key={l.code} className="flex items-center gap-3">
                        <div className="w-40 shrink-0 truncate text-sm">{l.name}</div>
                        <div className="h-2 flex-1 rounded-sm bg-muted">
                          <div
                            className="h-2 rounded-sm"
                            style={{
                              width: `${Math.max(0, Math.min(1, l.share ?? 0)) * 100}%`,
                              backgroundColor: EXPENSE_HUE,
                            }}
                          />
                        </div>
                        <div className="w-24 shrink-0 text-right text-sm tabular-nums">
                          {fmtFull(l.amount)}
                        </div>
                        <div className="w-12 shrink-0 text-right text-caption text-muted-foreground tabular-nums">
                          {l.share == null ? '—' : `${Math.round(l.share * 100)}%`}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 4. WHO OWES WHOM. */}
            <IntercompanyPanel
              vehicle={vehicle}
              vehicleId={vehicleId}
              balances={data.intercompany.balances}
              charges={data.intercompany.charges}
              onChanged={load}
            />

            <LedgerLinks vehicleId={vehicleId} />
          </div>
        )}
      </AccountingBody>
    </>
  )
}

/**
 * The manco's ledger pages.
 *
 * These are the SHARED accounting views, scoped to this vehicle — the same journal, bank feed,
 * statements, period close and QuickBooks import a fund uses, because a management company's books
 * are double-entry books like any other and a second implementation of them would be a second set
 * of bugs. They need the fund-accounting grant as well as this one; a viewer without it is
 * redirected back here rather than shown a page whose every request 403s (see ../guard.ts).
 */
function LedgerLinks({ vehicleId }: { vehicleId: string }) {
  const links = [
    { href: `/manco/${vehicleId}/journal`, label: 'Journal', icon: BookOpen, desc: 'Post and review entries, or author them as plain text.' },
    { href: `/manco/${vehicleId}/ledger`, label: 'General ledger', icon: Table2, desc: 'Each account, opening to closing balance.' },
    { href: `/manco/${vehicleId}/bank`, label: 'Bank transactions', icon: Landmark, desc: 'Import a feed and draft entries.' },
    { href: `/manco/${vehicleId}/statements`, label: 'Financial statements', icon: FileText, desc: 'Balance sheet, P&L, cash flows.' },
    { href: `/manco/${vehicleId}/periods`, label: 'Period close', icon: Lock, desc: 'Close and lock a period.' },
    { href: `/manco/${vehicleId}/migrate`, label: 'QuickBooks import', icon: Upload, desc: 'Bring in the general ledger history.' },
  ]
  return (
    <Card>
      <CardContent className="pt-4 pb-4 px-4">
        <p className="text-sm font-medium mb-3">Books</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {links.map(l => (
            <Link
              key={l.href}
              href={l.href}
              className="flex items-start gap-3 rounded-lg border p-3 hover:bg-muted/50"
            >
              <l.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{l.label}</p>
                <p className="text-caption text-muted-foreground">{l.desc}</p>
              </div>
              <ArrowRight className="ml-auto mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
