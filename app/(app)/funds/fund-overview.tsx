'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, ChevronRight } from 'lucide-react'
import { useCurrency, formatCurrency, formatCurrencyFull } from '@/components/currency-context'

// The fund overview: performance per vehicle, DERIVED FROM THE LEDGER.
//
// This is what used to be the Funds page, where the numbers were typed in — commitments,
// called capital and distributions were hand-entered `fund_cash_flows` rows, cash-on-hand was
// a hand-entered figure, and carry was ESTIMATED with a heuristic because there was no way to
// know the real number.
//
// There is now. Every figure here comes from the capital accounts, and an LP's account is
// already net of the carry the close accrued to the GP — so "net to LP" is exact rather than
// approximated, and there is nothing to type in and nothing to keep in sync.

interface Metrics {
  committed: number; paidIn: number; uncalled: number; distributions: number
  nav: number; totalValue: number
  dpi: number | null; rvpi: number | null; tvpi: number | null; irr: number | null
}
interface Vehicle {
  vehicle: string
  vintageYear: number | null
  source: 'ledger' | 'events'
  lpCount: number
  fund: Metrics
  lp: Metrics
  gp: Metrics
  carryAccrued: number
}

type Lens = 'lp' | 'fund'

const moic = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}x`)
const irrPct = (v: number | null) => {
  if (v == null) return '—'
  const p = v * 100
  return `${(Object.is(p, -0) ? 0 : p).toFixed(1)}%`
}

export function FundOverview() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrency(v, currency)
  const fmtFull = (v: number) => formatCurrencyFull(v, currency)

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [asOf, setAsOf] = useState('')
  const [lens, setLens] = useState<Lens>('lp')

  const load = useCallback(() => {
    setLoading(true)
    const qs = asOf ? `?asOf=${asOf}` : ''
    fetch(`/api/accounting/fund-economics${qs}`)
      .then(r => (r.ok ? r.json() : { vehicles: [] }))
      .then(d => setVehicles(d.vehicles ?? []))
      .finally(() => setLoading(false))
  }, [asOf])
  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="rounded-lg border p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Deriving fund performance from the ledger…
      </div>
    )
  }
  if (vehicles.length === 0) return null

  const live = vehicles.filter(v => v.fund.committed > 0 || v.fund.paidIn > 0)
  if (live.length === 0) return null

  const m = (v: Vehicle) => (lens === 'lp' ? v.lp : v.fund)

  const totals = live.reduce((acc, v) => {
    const x = m(v)
    acc.committed += x.committed; acc.paidIn += x.paidIn; acc.uncalled += x.uncalled
    acc.distributions += x.distributions; acc.nav += x.nav; acc.totalValue += x.totalValue
    acc.carry += v.carryAccrued
    return acc
  }, { committed: 0, paidIn: 0, uncalled: 0, distributions: 0, nav: 0, totalValue: 0, carry: 0 })

  // Ratios computed AFTER summing — never averaged across vehicles.
  const tTvpi = totals.paidIn > 0 ? totals.totalValue / totals.paidIn : null
  const tDpi = totals.paidIn > 0 ? totals.distributions / totals.paidIn : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-4">
          <Headline label="Committed" value={fmt(totals.committed)} />
          <Headline label="Paid in" value={fmt(totals.paidIn)} />
          <Headline label="Distributed" value={fmt(totals.distributions)} />
          <Headline label="NAV" value={fmt(totals.nav)} />
          <Headline label="TVPI" value={moic(tTvpi)} strong />
          <Headline label="DPI" value={moic(tDpi)} />
        </div>

        <div className="flex items-end gap-2">
          {/* Net to LP is the honest default: it is what an LP would actually receive, and
              it is now exact rather than a carry estimate. */}
          <div className="inline-flex rounded-md border p-0.5 text-xs">
            {(['lp', 'fund'] as Lens[]).map(l => (
              <button
                key={l}
                onClick={() => setLens(l)}
                className={`px-2 py-1 rounded ${lens === l ? 'bg-muted font-medium' : 'text-muted-foreground'}`}
              >
                {l === 'lp' ? 'Net to LP' : 'Whole fund'}
              </button>
            ))}
          </div>
          <label className="text-xs text-muted-foreground">
            As of
            <input
              type="date"
              value={asOf}
              onChange={e => setAsOf(e.target.value)}
              className="mt-1 block h-8 px-2 rounded-md border border-input bg-background text-sm"
            />
          </label>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Vehicle</th>
              <th className="text-left px-3 py-2 font-medium">Vintage</th>
              <th className="text-right px-3 py-2 font-medium">Committed</th>
              <th className="text-right px-3 py-2 font-medium">Paid in</th>
              <th className="text-right px-3 py-2 font-medium">Uncalled</th>
              <th className="text-right px-3 py-2 font-medium">Distributed</th>
              <th className="text-right px-3 py-2 font-medium">NAV</th>
              <th className="text-right px-3 py-2 font-medium">DPI</th>
              <th className="text-right px-3 py-2 font-medium">RVPI</th>
              <th className="text-right px-3 py-2 font-medium">TVPI</th>
              <th className="text-right px-3 py-2 font-medium">IRR</th>
            </tr>
          </thead>
          <tbody>
            {live.map(v => {
              const x = m(v)
              return (
                <tr key={v.vehicle} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Link href="/funds/capital-accounts" className="inline-flex items-center gap-1 hover:underline">
                      {v.vehicle}
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    </Link>
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                      {v.source === 'ledger' ? 'ledger' : 'capital tracking'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">{v.vintageYear ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtFull(x.committed)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtFull(x.paidIn)}</td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">{fmtFull(x.uncalled)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtFull(x.distributions)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtFull(x.nav)}</td>
                  <td className="px-3 py-2 text-right font-mono">{moic(x.dpi)}</td>
                  <td className="px-3 py-2 text-right font-mono">{moic(x.rvpi)}</td>
                  <td className="px-3 py-2 text-right font-mono font-medium">{moic(x.tvpi)}</td>
                  <td className="px-3 py-2 text-right font-mono">{irrPct(x.irr)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground max-w-3xl">
        Every figure is derived from the capital accounts — nothing here is typed in.{' '}
        {lens === 'lp' ? (
          <>
            <strong>Net to LP</strong> is the LP-class partners&rsquo; own accounts, so the GP&rsquo;s carry
            {totals.carry !== 0 && <> ({fmtFull(totals.carry)} accrued)</>} is already deducted — this is not an
            estimate.
          </>
        ) : (
          <><strong>Whole fund</strong> is every partner, GP included. Carry is an allocation between them, so it nets
          out at this level.</>
        )}{' '}
        Paid-in is capital <em>recognised</em> — capital is recognised when it is called, and a call may still be
        unfunded.
      </p>
    </div>
  )
}

function Headline({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-mono ${strong ? 'text-lg font-semibold' : 'text-base'}`}>{value}</p>
    </div>
  )
}
