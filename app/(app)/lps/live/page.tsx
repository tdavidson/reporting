'use client'

// The live LP capital report.
//
// The other way to produce this report is a SNAPSHOT: import a spreadsheet, freeze the rows.
// This one derives the same figures from whatever the books say right now, as of any date,
// for every vehicle — those with double-entry books and those with only lp_capital_events.
//
// It writes nothing and creates no snapshot. Reload it tomorrow and the numbers may differ,
// because the books may have. That is the point.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, BookOpen, ListTree, ChevronRight, ChevronDown, Calendar } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useCurrency, formatCurrencyFull } from '@/components/currency-context'

interface LiveRow {
  entity_id: string
  entity_name: string
  investor_id: string
  investor_name: string
  portfolio_group: string
  source: 'ledger' | 'events'
  /** Set when this is a member's share of an associate/GP vehicle's position, not a direct one. */
  lookThroughVia?: string
  commitment: number
  called_capital: number
  paid_in_capital: number
  distributions: number
  nav: number
  total_value: number
  outstanding_balance: number
}

interface Payload {
  asOf: string | null
  vehicles: { group: string; source: 'ledger' | 'events'; lps: number }[]
  rows: LiveRow[]
}

interface Totals {
  commitment: number
  paid_in_capital: number
  distributions: number
  nav: number
  total_value: number
  outstanding_balance: number
  dpi: number | null
  tvpi: number | null
}

/** Sum money, THEN derive ratios. Averaging per-row ratios would weight a $10k LP the same
 *  as a $10m one — which is why every existing read path does it in this order too. */
function total(rows: LiveRow[]): Totals {
  const t = rows.reduce(
    (a, r) => ({
      commitment: a.commitment + r.commitment,
      paid_in_capital: a.paid_in_capital + r.paid_in_capital,
      distributions: a.distributions + r.distributions,
      nav: a.nav + r.nav,
      total_value: a.total_value + r.total_value,
      outstanding_balance: a.outstanding_balance + r.outstanding_balance,
    }),
    { commitment: 0, paid_in_capital: 0, distributions: 0, nav: 0, total_value: 0, outstanding_balance: 0 }
  )
  const paid = t.paid_in_capital
  return {
    ...t,
    dpi: paid > 0 ? Math.round((t.distributions / paid) * 10000) / 10000 : null,
    tvpi: paid > 0 ? Math.round(((t.distributions + t.nav) / paid) * 10000) / 10000 : null,
  }
}

export default function LiveCapitalReportPage() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyFull(v, currency)

  const [asOf, setAsOf] = useState('')
  const [applied, setApplied] = useState('')
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async (date: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/lps/live-report${date ? `?asOf=${date}` : ''}`)
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed to build the report')
      setData(j)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(applied) }, [load, applied])

  // Roll up per investor: an LP holding through two entities across three vehicles is ONE
  // line on this report, with the vehicle rows underneath.
  const investors = useMemo(() => {
    const byInvestor = new Map<string, { id: string; name: string; rows: LiveRow[] }>()
    for (const r of data?.rows ?? []) {
      const cur = byInvestor.get(r.investor_id) ?? { id: r.investor_id, name: r.investor_name, rows: [] }
      cur.rows.push(r)
      byInvestor.set(r.investor_id, cur)
    }
    return Array.from(byInvestor.values())
      .map(i => ({ ...i, totals: total(i.rows) }))
      .sort((a, b) => b.totals.commitment - a.totals.commitment || a.name.localeCompare(b.name))
  }, [data])

  const grand = useMemo(() => total(data?.rows ?? []), [data])

  const toggle = (id: string) =>
    setExpanded(s => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return (
    <div className="px-4 md:pl-8 md:pr-4 pt-3 pb-8 w-full space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Live capital report</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Every LP&rsquo;s capital, derived from the books right now rather than from a stored
          snapshot. Vehicles with double-entry books report from their ledger; vehicles without
          report from their capital events. Nothing here is saved.
        </p>
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            <Calendar className="h-3 w-3" /> As of
          </label>
          <Input
            type="date"
            className="w-44"
            value={asOf}
            onChange={e => setAsOf(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={() => setApplied(asOf)} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
          {asOf ? 'Rebuild' : 'Latest'}
        </Button>
        {applied && (
          <Button size="sm" variant="ghost" onClick={() => { setAsOf(''); setApplied('') }}>
            Clear date
          </Button>
        )}
        <span className="text-sm text-muted-foreground ml-2">
          {applied ? <>as of <span className="font-medium text-foreground">{applied}</span></> : 'all activity to date'}
        </span>
      </div>

      {error && (
        <Card><CardContent className="p-4 text-red-600 text-sm">{error}</CardContent></Card>
      )}

      {loading && !data ? (
        <div className="flex items-center py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Deriving from the ledger…
        </div>
      ) : data ? (
        <>
          {/* Provenance up front. A vehicle sourced from 'events' with nothing entered reports
              zeros — the reader has to know that before trusting a single figure below. */}
          <Card>
            <CardContent className="p-4">
              <div className="text-sm font-medium mb-3">Where each vehicle&rsquo;s numbers come from</div>
              <div className="flex flex-wrap gap-2">
                {data.vehicles.map(v => (
                  <Badge key={v.group} variant="outline" className="gap-1.5 py-1">
                    {v.source === 'ledger' ? <BookOpen className="h-3.5 w-3.5" /> : <ListTree className="h-3.5 w-3.5" />}
                    <span className="font-medium">{v.group}</span>
                    <span className="text-muted-foreground">
                      {v.source === 'ledger' ? 'ledger' : 'events'} · {v.lps} LP{v.lps === 1 ? '' : 's'}
                    </span>
                  </Badge>
                ))}
                {data.vehicles.length === 0 && (
                  <span className="text-sm text-muted-foreground">No vehicles found.</span>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Stat label="Commitment" value={fmt(grand.commitment)} />
            <Stat label="Paid in" value={fmt(grand.paid_in_capital)} />
            <Stat label="Distributions" value={fmt(grand.distributions)} />
            <Stat label="NAV" value={fmt(grand.nav)} />
            <Stat label="TVPI" value={grand.tvpi != null ? `${grand.tvpi.toFixed(2)}x` : '—'} />
          </div>

          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left font-medium p-3">Investor</th>
                    <th className="text-right font-medium p-3">Commitment</th>
                    <th className="text-right font-medium p-3">Paid in</th>
                    <th className="text-right font-medium p-3">Unfunded</th>
                    <th className="text-right font-medium p-3">Distributions</th>
                    <th className="text-right font-medium p-3">NAV</th>
                    <th className="text-right font-medium p-3">DPI</th>
                    <th className="text-right font-medium p-3">TVPI</th>
                  </tr>
                </thead>
                <tbody>
                  {investors.map(inv => {
                    const open = expanded.has(inv.id)
                    const multi = inv.rows.length > 1
                    return (
                      <Fragment key={inv.id}>
                        <tr
                          className={`border-b ${multi ? 'cursor-pointer hover:bg-muted/20' : ''}`}
                          onClick={() => multi && toggle(inv.id)}
                        >
                          <td className="p-3 font-medium">
                            <span className="flex items-center gap-1">
                              {multi ? (
                                open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
                              ) : (
                                <span className="w-3.5" />
                              )}
                              {inv.name}
                              {multi && (
                                <span className="text-xs text-muted-foreground font-normal ml-1">
                                  ({inv.rows.length} vehicles)
                                </span>
                              )}
                            </span>
                          </td>
                          <Money v={inv.totals.commitment} fmt={fmt} />
                          <Money v={inv.totals.paid_in_capital} fmt={fmt} />
                          <Money v={inv.totals.outstanding_balance} fmt={fmt} />
                          <Money v={inv.totals.distributions} fmt={fmt} />
                          <Money v={inv.totals.nav} fmt={fmt} />
                          <td className="p-3 text-right tabular-nums text-muted-foreground">
                            {inv.totals.dpi != null ? `${inv.totals.dpi.toFixed(2)}x` : '—'}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {inv.totals.tvpi != null ? `${inv.totals.tvpi.toFixed(2)}x` : '—'}
                          </td>
                        </tr>
                        {open && inv.rows.map(r => (
                          <tr key={`${inv.id}-${r.entity_id}-${r.portfolio_group}`} className="border-b bg-muted/10 text-muted-foreground">
                            <td className="p-3 pl-10 text-xs">
                              {r.portfolio_group}
                              {r.entity_name !== inv.name && <span className="ml-1">· {r.entity_name}</span>}
                              <Badge variant="outline" className="ml-2 text-[10px] py-0 px-1">
                                {r.source}
                              </Badge>
                              {/* A look-through row is the member's share of an associate's
                                  position, not a direct holding. Say so — otherwise it reads as
                                  though they invested in the fund directly, and nobody can tell
                                  the look-through from double-counting. */}
                              {r.lookThroughVia && (
                                <Badge variant="secondary" className="ml-1 text-[10px] py-0 px-1">
                                  via {r.lookThroughVia}
                                </Badge>
                              )}
                            </td>
                            <Money v={r.commitment} fmt={fmt} small />
                            <Money v={r.paid_in_capital} fmt={fmt} small />
                            <Money v={r.outstanding_balance} fmt={fmt} small />
                            <Money v={r.distributions} fmt={fmt} small />
                            <Money v={r.nav} fmt={fmt} small />
                            <td colSpan={2} />
                          </tr>
                        ))}
                      </Fragment>
                    )
                  })}
                  {investors.length === 0 && (
                    <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">
                      No LP capital found. Book a vehicle&rsquo;s history, or add capital events for one.
                    </td></tr>
                  )}
                </tbody>
                {investors.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 font-medium bg-muted/30">
                      <td className="p-3">Total</td>
                      <Money v={grand.commitment} fmt={fmt} />
                      <Money v={grand.paid_in_capital} fmt={fmt} />
                      <Money v={grand.outstanding_balance} fmt={fmt} />
                      <Money v={grand.distributions} fmt={fmt} />
                      <Money v={grand.nav} fmt={fmt} />
                      <td className="p-3 text-right tabular-nums">
                        {grand.dpi != null ? `${grand.dpi.toFixed(2)}x` : '—'}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {grand.tvpi != null ? `${grand.tvpi.toFixed(2)}x` : '—'}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}

function Money({ v, fmt, small }: { v: number; fmt: (n: number) => string; small?: boolean }) {
  return (
    <td className={`p-3 text-right tabular-nums whitespace-nowrap ${small ? 'text-xs' : ''}`}>
      {fmt(v)}
    </td>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold mt-1 tabular-nums">{value}</div>
      </CardContent>
    </Card>
  )
}
