'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell,
} from 'recharts'
import { Loader2, Gauge, ArrowRight } from 'lucide-react'
import { useCurrency, formatCurrency, formatCurrencyFull } from '@/components/currency-context'
import { useVehicle } from '@/components/accounting-vehicle'
import { AnalystToggleButton } from '@/components/analyst-button'
import { Card, CardContent } from '@/components/ui/card'

// The fund detail (lead) page. Everything here is READ-ONLY and derived — the same numbers as the
// /funds overview (fund-economics), the schedule of investments (statements), and the growth
// series (fund-timeseries). Operational admin lives on /funds/status.

interface Metrics {
  committed: number; paidIn: number; uncalled: number; distributions: number
  nav: number; totalValue: number
  dpi: number | null; rvpi: number | null; tvpi: number | null; irr: number | null
}
interface VehicleEconomics {
  vehicle: string; vintageYear: number | null; source: 'ledger' | 'events'; lpCount: number
  fund: Metrics; lp: Metrics; gp?: Metrics; carryAccrued?: number
}
interface SoiGroup { name: string; cost: number; fairValue: number; pctOfNetAssets: number }
interface SoiRow { name: string; cost: number; fairValue: number; pctOfNetAssets: number; moic?: number | null; industry?: string | null }
interface Soi {
  rows: SoiRow[]; totalCost: number; totalFairValue: number; netAssets: number
  source: 'tracker' | 'ledger'; byIndustry: SoiGroup[]; byGeography: SoiGroup[]; byAssetType: SoiGroup[]
}
interface TsPoint {
  period: string; label: string
  calledCapital: number; distributed: number
  contributions: number; distributions: number; operatingIncome: number
  realizedGains: number; unrealizedGains: number; expenses: number; other: number; nav: number
  investedCapital: number; proceeds: number; portfolioValue: number
}
interface Timeseries { points: TsPoint[]; hasGross: boolean }

type Lens = 'lp' | 'fund'

// Categorical hues, assigned in FIXED order from the theme's chart ramp (never cycled).
const HUE = {
  chart1: 'hsl(var(--chart-1))',
  chart2: 'hsl(var(--chart-2))',
  chart3: 'hsl(var(--chart-3))',
  chart4: 'hsl(var(--chart-4))',
  chart5: 'hsl(var(--chart-5))',
  ink: 'hsl(var(--foreground))',
  muted: 'hsl(var(--muted-foreground))',
  surface: 'hsl(var(--background))',
}
// A fixed palette for the SOI breakdown slices, so a slice keeps its colour as the mix changes.
const SLICE = [HUE.chart2, HUE.chart1, HUE.chart3, HUE.chart4, HUE.chart5, HUE.muted]

const moic = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(2)}x`)
const irrPct = (v: number | null | undefined) => {
  if (v == null) return '—'
  const p = v * 100
  return `${(Object.is(p, -0) ? 0 : p).toFixed(1)}%`
}

export function FundDetailView({ vehicle }: { vehicle: string }) {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrency(v, currency)
  const fmtFull = (v: number) => formatCurrencyFull(v, currency)
  const { setGroup } = useVehicle()

  const [econ, setEcon] = useState<VehicleEconomics | null>(null)
  const [soi, setSoi] = useState<Soi | null>(null)
  const [ts, setTs] = useState<Timeseries | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [lens, setLens] = useState<Lens>('lp')

  // Pin the section's vehicle context to this URL, so the Analyst and any subpage the user opens
  // from here (Admin, capital accounts, …) inherit the fund they're looking at.
  useEffect(() => { setGroup(vehicle) }, [vehicle, setGroup])

  const g = `group=${encodeURIComponent(vehicle)}`
  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/accounting/fund-economics').then(r => (r.ok ? r.json() : { vehicles: [] })),
      fetch(`/api/accounting/statements?${g}&preset=itd`).then(r => (r.ok ? r.json() : null)),
      fetch(`/api/accounting/fund-timeseries?${g}`).then(r => (r.ok ? r.json() : null)),
    ]).then(([e, s, t]) => {
      const found = (e.vehicles ?? []).find((v: VehicleEconomics) => v.vehicle === vehicle) ?? null
      setEcon(found)
      setNotFound(!found)
      setSoi(s?.scheduleOfInvestments ?? null)
      setTs(t && !t.error ? t : null)
    }).finally(() => setLoading(false))
  }, [g, vehicle])
  useEffect(() => { load() }, [load])

  const hasGpSplit = !!econ && ((econ.gp?.paidIn ?? 0) !== 0 || (econ.gp?.nav ?? 0) !== 0 || (econ.carryAccrued ?? 0) !== 0)
  const effectiveLens: Lens = hasGpSplit ? lens : 'fund'
  const m = econ ? (effectiveLens === 'lp' ? econ.lp : econ.fund) : null

  if (loading) {
    return (
      <div className="rounded-lg border p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading fund detail…
      </div>
    )
  }
  if (notFound || !econ || !m) {
    return (
      <div className="rounded-lg border p-6 space-y-3 max-w-lg">
        <p className="text-sm">No vehicle named <strong>{vehicle}</strong> was found, or it carries no capital yet.</p>
        <Link href="/funds" className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent transition-colors">
          Back to all funds <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header — name, provenance, and the jump to the admin page. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight truncate" title={vehicle}>{vehicle}</h1>
          <p className="text-sm text-muted-foreground">
            {econ.vintageYear ? <>Vintage {econ.vintageYear} · </> : null}
            {econ.source === 'ledger' ? 'Fund accounting' : 'LP capital tracking'} · {econ.lpCount} {econ.lpCount === 1 ? 'partner' : 'partners'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasGpSplit && (
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
          )}
          <Link
            href="/funds/status"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
          >
            <Gauge className="h-3.5 w-3.5" /> Admin
          </Link>
          {/* The chrome's Analyst toggle steps aside for the detail route (it owns its layout), so
              the toggle rides here instead — same top-right placement as every accounting page. */}
          <AnalystToggleButton />
        </div>
      </div>

      {/* Key metrics — same Card treatment as the /funds overview and the LP snapshot. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricBox label="Committed" value={fmt(m.committed)} />
        <MetricBox label="Called" value={fmt(m.paidIn)} />
        <MetricBox label="Uncalled" value={fmt(m.uncalled)} />
        <MetricBox label="Distributed" value={fmt(m.distributions)} />
        <MetricBox label="NAV" value={fmt(m.nav)} />
        <MetricBox label="TVPI" value={moic(m.tvpi)} />
        <MetricBox label="DPI" value={moic(m.dpi)} />
        <MetricBox label="IRR" value={irrPct(m.irr)} />
      </div>

      {/* Growth over time — two full-width charts. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <FundGrowthChart points={ts?.points ?? []} hasGross={!!ts?.hasGross} fmt={fmt} fmtFull={fmtFull} />
        <NavCompositionChart points={ts?.points ?? []} fmt={fmt} fmtFull={fmtFull} />
      </div>

      {/* Investment breakdown — from the schedule of investments (tracker rows). */}
      {soi && soi.source === 'tracker' && soi.rows.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <BreakdownChart title="By industry" groups={soi.byIndustry} fmt={fmt} fmtFull={fmtFull} />
          <BreakdownChart
            title={soi.byAssetType.length > 1 ? 'By asset type' : 'By geography'}
            groups={soi.byAssetType.length > 1 ? soi.byAssetType : soi.byGeography}
            fmt={fmt}
            fmtFull={fmtFull}
          />
          <div className="lg:col-span-2">
            <TopHoldings rows={soi.rows} totalFairValue={soi.totalFairValue} fmt={fmt} fmtFull={fmtFull} />
          </div>
        </div>
      ) : (
        <ChartCard title="Investments">
          <div className="flex h-[220px] items-center justify-center text-center text-sm text-muted-foreground px-6">
            No per-company investment detail is tracked for this vehicle yet. Record holdings on the{' '}
            <Link href="/funds/schedule-of-investments" className="underline underline-offset-2 hover:text-foreground mx-1">
              schedule of investments
            </Link>{' '}
            and they&rsquo;ll break down here.
          </div>
        </ChartCard>
      )}

      <p className="text-xs text-muted-foreground max-w-3xl">
        Every figure is derived — the metrics from the capital accounts (the same numbers as the funds overview),
        the breakdown from the schedule of investments, and the growth charts from the dated ledger and portfolio
        history. The growth charts are whole-fund; the metric lens above scopes only the boxes.
      </p>
    </div>
  )
}

// ── Shared pieces ───────────────────────────────────────────────────────────

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 px-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  )
}

function ChartCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4 px-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="text-sm font-medium">{title}</p>
          {action}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

const AXIS = { fontSize: 11 } as const
const tooltipStyle = {
  borderRadius: '6px',
  border: '1px solid hsl(var(--border))',
  backgroundColor: 'hsl(var(--popover))',
  color: 'hsl(var(--popover-foreground))',
  fontSize: '12px',
} as const

function EmptyPlot({ label }: { label: string }) {
  return <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">{label}</div>
}

// ── Fund growth over time: stacked bars, toggle gross ⇄ net ───────────────────

function FundGrowthChart({
  points, hasGross, fmt, fmtFull,
}: { points: TsPoint[]; hasGross: boolean; fmt: (v: number) => string; fmtFull: (v: number) => string }) {
  const [mode, setMode] = useState<'net' | 'gross'>('net')
  const view = hasGross ? mode : 'net'

  const toggle = hasGross ? (
    <div className="inline-flex rounded-md border p-0.5 text-xs">
      {(['net', 'gross'] as const).map(mo => (
        <button
          key={mo}
          onClick={() => setMode(mo)}
          className={`px-2 py-1 rounded ${mode === mo ? 'bg-muted font-medium' : 'text-muted-foreground'}`}
        >
          {mo === 'net' ? 'Called & distributed' : 'Invested & proceeds'}
        </button>
      ))}
    </div>
  ) : undefined

  // Called capital and distributions are the LP-cash view; invested capital and proceeds are the
  // deal-level (gross) view of the same fund. Distinct series → distinct fixed hues.
  const series = view === 'net'
    ? [
        { key: 'calledCapital', name: 'Called capital', color: HUE.chart3 },
        { key: 'distributed', name: 'Distributed', color: HUE.chart2 },
      ]
    : [
        { key: 'investedCapital', name: 'Invested capital', color: HUE.chart1 },
        { key: 'proceeds', name: 'Proceeds', color: HUE.chart4 },
      ]

  return (
    <ChartCard title="Fund growth over time" action={toggle}>
      {points.length === 0 ? (
        <EmptyPlot label="No dated activity yet." />
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="equidistantPreserveStart" className="text-muted-foreground" />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={52} tickFormatter={fmt} className="text-muted-foreground" />
            <Tooltip cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} contentStyle={tooltipStyle} formatter={(v: any, n: any) => [fmtFull(v as number), n]} />
            <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stackId="a"
                fill={s.color}
                stroke={HUE.surface}
                strokeWidth={1}
                radius={i === series.length - 1 ? [3, 3, 0, 0] : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}

// ── NAV growth over time: stacked composition + NAV total line ────────────────

const NAV_SERIES = [
  { key: 'netPaidIn', name: 'Net paid-in capital', color: HUE.chart3 },
  { key: 'realizedGains', name: 'Realized gains', color: HUE.chart2 },
  { key: 'unrealizedGains', name: 'Unrealized gains', color: HUE.chart1 },
  { key: 'operatingIncome', name: 'Operating income', color: HUE.chart5 },
  { key: 'expenses', name: 'Expenses & fees', color: HUE.chart4 },
  { key: 'other', name: 'Other', color: HUE.muted },
] as const

function NavCompositionChart({
  points, fmt, fmtFull,
}: { points: TsPoint[]; fmt: (v: number) => string; fmtFull: (v: number) => string }) {
  // Net paid-in = contributions net of capital returned. The rest of the composition (gains,
  // income, expenses) is already signed so the stack sums to NAV, which the overlaid line traces.
  const data = useMemo(
    () => points.map(p => ({ ...p, netPaidIn: Math.round((p.contributions + p.distributions) * 100) / 100 })),
    [points],
  )
  const shown = NAV_SERIES.filter(s => data.some(d => Math.abs(Number((d as any)[s.key])) > 0.5))

  return (
    <ChartCard title="NAV growth over time">
      {points.length === 0 ? (
        <EmptyPlot label="No dated activity yet." />
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} stackOffset="sign">
            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="equidistantPreserveStart" className="text-muted-foreground" />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={52} tickFormatter={fmt} className="text-muted-foreground" />
            <Tooltip cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} contentStyle={tooltipStyle} formatter={(v: any, n: any) => [fmtFull(v as number), n]} />
            <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
            {shown.map(s => (
              <Bar key={s.key} dataKey={s.key} name={s.name} stackId="nav" fill={s.color} stroke={HUE.surface} strokeWidth={1} />
            ))}
            {/* Total NAV traced in ink, not a series colour — it's a reference, not a category. */}
            <Line type="monotone" dataKey="nav" name="NAV" stroke={HUE.ink} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}

// ── Investment breakdown: donut by a dimension ────────────────────────────────

function BreakdownChart({
  title, groups, fmt, fmtFull,
}: { title: string; groups: SoiGroup[]; fmt: (v: number) => string; fmtFull: (v: number) => string }) {
  // Cap the legend: keep the top 5 slices by fair value, fold the tail into "Other".
  const data = useMemo(() => {
    const sorted = [...groups].filter(g => g.fairValue > 0).sort((a, b) => b.fairValue - a.fairValue)
    if (sorted.length <= 6) return sorted
    const head = sorted.slice(0, 5)
    const tail = sorted.slice(5).reduce((s, g) => s + g.fairValue, 0)
    return [...head, { name: 'Other', cost: 0, fairValue: tail, pctOfNetAssets: 0 }]
  }, [groups])
  const total = data.reduce((s, g) => s + g.fairValue, 0)

  return (
    <ChartCard title={title}>
      {data.length === 0 ? (
        <EmptyPlot label="Nothing to break down." />
      ) : (
        <div className="flex items-center gap-4">
          <ResponsiveContainer width="55%" height={220}>
            <PieChart>
              <Pie data={data} dataKey="fairValue" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={80} paddingAngle={2} stroke={HUE.surface} strokeWidth={2}>
                {data.map((_, i) => <Cell key={i} fill={SLICE[i % SLICE.length]} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [fmtFull(v as number), n]} />
            </PieChart>
          </ResponsiveContainer>
          {/* Direct-labelled legend — identity + magnitude beside each swatch, in ink. */}
          <ul className="flex-1 space-y-1.5 text-xs min-w-0">
            {data.map((gp, i) => (
              <li key={gp.name} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SLICE[i % SLICE.length] }} />
                <span className="truncate flex-1" title={gp.name}>{gp.name}</span>
                <span className="font-mono text-muted-foreground shrink-0">{fmt(gp.fairValue)}</span>
                <span className="font-mono text-muted-foreground/70 shrink-0 w-10 text-right">
                  {total ? `${Math.round((gp.fairValue / total) * 100)}%` : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  )
}

// ── Top holdings — horizontal magnitude bars ──────────────────────────────────

function TopHoldings({
  rows, totalFairValue, fmt, fmtFull,
}: { rows: SoiRow[]; totalFairValue: number; fmt: (v: number) => string; fmtFull: (v: number) => string }) {
  const top = [...rows].filter(r => r.fairValue > 0).sort((a, b) => b.fairValue - a.fairValue).slice(0, 8)
  const max = top.reduce((mx, r) => Math.max(mx, r.fairValue), 0)
  if (top.length === 0) return null

  return (
    <ChartCard title="Largest holdings">
      <div className="space-y-2">
        {top.map(r => (
          <div key={r.name} className="flex items-center gap-3 text-sm">
            <div className="w-40 shrink-0 truncate" title={r.name}>{r.name}</div>
            <div className="flex-1 min-w-0">
              <div className="h-4 rounded-sm bg-muted/50 overflow-hidden">
                <div
                  className="h-full rounded-sm"
                  style={{ width: max ? `${Math.max(2, (r.fairValue / max) * 100)}%` : '0%', background: HUE.chart2 }}
                />
              </div>
            </div>
            <div className="w-20 shrink-0 text-right font-mono" title={fmtFull(r.fairValue)}>{fmt(r.fairValue)}</div>
            <div className="w-12 shrink-0 text-right font-mono text-muted-foreground">{r.moic == null ? '—' : `${r.moic.toFixed(1)}x`}</div>
            <div className="w-12 shrink-0 text-right font-mono text-muted-foreground/70">
              {totalFairValue ? `${Math.round((r.fairValue / totalFairValue) * 100)}%` : '—'}
            </div>
          </div>
        ))}
      </div>
    </ChartCard>
  )
}
