'use client'

import { useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, Cell,
} from 'recharts'
import { ChartCard, EmptyPlot, AXIS, tooltipStyle, HUE, INVEST_NEW, PROCEEDS_HUE } from '@/components/fund-chart-kit'
import type { ForecastSchedule } from '@/lib/accounting/construction-forecast'
import type { SimulationResult } from '@/lib/accounting/construction-simulation'

/**
 * The plan on a date axis — the three pictures the pacing layer makes possible.
 *
 * The construction charts (charts.tsx) are compositions and scenarios because the model has no
 * clock. These have one, stated by the GP in the pacing assumptions, and so they can be honest
 * time series. Same chart vocabulary (fund-chart-kit) so called capital and proceeds keep the hues
 * they have on the fund page.
 */

type Fmt = (v: number | null) => string

/** A point on the fund's actual growth series, already reduced to multiples. */
export interface ActualPoint {
  /** Decimal calendar year, e.g. 2024.75 for a Q3 '24 quarter end. */
  x: number
  label: string
  tvpi: number | null
  dpi: number | null
}

export interface ActualCashFlow {
  year: number
  called: number
  invested: number
  expenses: number
  distributed: number
  lpDistributed: number
  carriedInterest: number
}

const TVPI_HUE = HUE.chart1
const DPI_HUE = HUE.chart2
const TVPI_BAND_OUTER = 'hsl(var(--chart-1) / 0.12)'
const TVPI_BAND_INNER = 'hsl(var(--chart-1) / 0.24)'
const DPI_BAND_OUTER = 'hsl(var(--chart-2) / 0.12)'
const DPI_BAND_INNER = 'hsl(var(--chart-2) / 0.24)'
const DISTRIBUTION_BAND = 'hsl(var(--chart-2) / 0.24)'

function niceCurrencyScale(min: number, max: number): { domain: [number, number]; ticks: number[] } {
  const span = Math.max(1, max - min)
  const roughStep = span / 5
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)))
  const normalized = roughStep / magnitude
  const multiplier = normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10
  const step = multiplier * magnitude
  const lower = Math.floor(Math.min(0, min) / step) * step
  const upper = Math.ceil(Math.max(0, max) / step) * step
  const ticks: number[] = []
  for (let value = lower; value <= upper + step / 2; value += step) ticks.push(value)
  return { domain: [lower, upper], ticks }
}

// ── J-curve: DPI and TVPI over time, history solid and forecast dashed ────────
//
// ONE axis, in multiples of called capital. Called capital and distributions in dollars belong on
// the cash-flow chart beside this one, not on a second axis here. The simulation's spread sits
// behind the forecast line as two bands of the TVPI hue at two opacities — a sequential encoding of
// "how likely", not a second series — and the legend names the lines; the caption names the bands.

export function JCurveChart({ actual, schedule, simulation, netOfCarry, multiple }: {
  actual: ActualPoint[]
  schedule: ForecastSchedule
  simulation: SimulationResult | null
  netOfCarry: boolean
  multiple: (v: number | null) => string
}) {
  const data = useMemo(() => {
    const baseYear = schedule.years[0]?.calendarYear ?? new Date().getFullYear()
    const rows = new Map<number, Record<string, number | [number, number] | null | string>>()
    // The source series is quarterly. Use the latest observation in each calendar year so this
    // chart has the same annual cadence as the cash-flow chart beside it.
    for (const p of actual) {
      const year = Math.floor(p.x)
      rows.set(year, { x: year, label: String(year), tvpiActual: p.tvpi, dpiActual: p.dpi })
    }
    const simByYear = new Map((simulation?.years ?? []).map(y => [y.year, y]))
    for (const y of schedule.years) {
      const x = baseYear + y.year
      const sim = simByYear.get(y.year)
      const row = rows.get(x) ?? { x, label: String(x) }
      // Year 0 is today: the forecast starts from the last actual point, so the two lines meet.
      row.tvpiForecast = y.tvpi
      row.dpiForecast = y.dpi
      row.label = String(x)
      if (sim) {
        row.tvpiOuter = [sim.tvpi.p10, sim.tvpi.p90]
        row.tvpiInner = [sim.tvpi.p25, sim.tvpi.p75]
        row.dpiOuter = [sim.dpi.p10, sim.dpi.p90]
        row.dpiInner = [sim.dpi.p25, sim.dpi.p75]
      }
      rows.set(x, row)
    }
    return Array.from(rows.values()).sort((a, b) => (a.x as number) - (b.x as number))
  }, [actual, schedule, simulation])

  const hasForecast = schedule.years.length > 1
  const hasBand = !!simulation && simulation.stated
  const yMax = useMemo(() => {
    const values: number[] = []
    for (const row of data) {
      for (const key of ['tvpiActual', 'dpiActual', 'tvpiForecast', 'dpiForecast', 'tvpiOuter', 'dpiOuter'] as const) {
        const value = row[key]
        if (typeof value === 'number') values.push(value)
        else if (Array.isArray(value)) values.push(...value)
      }
    }
    const highest = Math.max(1, ...values.filter(Number.isFinite))
    return Math.max(1, Math.ceil(highest * 1.08))
  }, [data])
  const yTicks = useMemo(() => Array.from({ length: yMax + 1 }, (_, index) => index), [yMax])

  return (
    <ChartCard title={`${netOfCarry ? 'LP net' : 'Gross fund'} DPI and TVPI by year`}>
      {!hasForecast ? (
        <EmptyPlot label="State the pacing assumptions to see the J-curve." />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
              <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v: number) => String(Math.round(v))} allowDecimals={false} className="text-muted-foreground" />
              <YAxis domain={[0, yMax]} ticks={yTicks} allowDataOverflow tick={AXIS} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => `${v.toFixed(1)}x`} className="text-muted-foreground" />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(_l, payload) => String((payload?.[0]?.payload as { label?: string } | undefined)?.label ?? '')}
                formatter={(v: any, n: any) => {
                  if (Array.isArray(v)) return [`${multiple(v[0])} – ${multiple(v[1])}`, n]
                  return [multiple(v as number), n]
                }}
              />
              <ReferenceLine y={1} stroke="hsl(var(--border))" />
              {hasBand && <Area dataKey="tvpiOuter" name="TVPI, 10th–90th percentile" stroke="none" fill={TVPI_BAND_OUTER} isAnimationActive={false} connectNulls legendType="none" />}
              {hasBand && <Area dataKey="tvpiInner" name="TVPI, 25th–75th percentile" stroke="none" fill={TVPI_BAND_INNER} isAnimationActive={false} connectNulls legendType="none" />}
              {hasBand && <Area dataKey="dpiOuter" name="DPI, 10th–90th percentile" stroke="none" fill={DPI_BAND_OUTER} isAnimationActive={false} connectNulls legendType="none" />}
              {hasBand && <Area dataKey="dpiInner" name="DPI, 25th–75th percentile" stroke="none" fill={DPI_BAND_INNER} isAnimationActive={false} connectNulls legendType="none" />}
              <Line type="monotone" dataKey="tvpiActual" name="TVPI to date" stroke={TVPI_HUE} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} legendType="none" />
              <Line type="monotone" dataKey="tvpiForecast" name="TVPI forecast" stroke={TVPI_HUE} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2 }} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} legendType="none" />
              <Line type="monotone" dataKey="dpiActual" name="DPI to date" stroke={DPI_HUE} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} legendType="none" />
              <Line type="monotone" dataKey="dpiForecast" name="DPI forecast" stroke={DPI_HUE} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2 }} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} legendType="none" />
            </ComposedChart>
          </ResponsiveContainer>
          {/* A legend of our own: recharts' would list six entries for what are two series
              (each drawn twice, solid then dashed), and the bands are not series at all. */}
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: TVPI_HUE }} /> TVPI</li>
            <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: DPI_HUE }} /> DPI</li>
            {hasBand && <li className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm" style={{ background: `linear-gradient(90deg, ${TVPI_BAND_INNER} 50%, ${DPI_BAND_INNER} 50%)` }} /> Simulation bands</li>}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">
            Solid is the fund to date; dashed is the plan on the stated pacing.
            {hasBand ? ' The shaded bands use each forecast line’s color and show its 25th–75th and 10th–90th percentiles.' : ''}
            {' '}Multiples are {netOfCarry ? 'LP-only and net of carry' : 'gross fund performance before carry'}.
          </p>
        </>
      )}
    </ChartCard>
  )
}

// ── Cash flows by year ───────────────────────────────────────────────────────
//
// Called capital drawn below the line, proceeds returned above it, with the cumulative net position
// as a line — all in dollars, one axis. Called capital keeps the fund page's "invested" hue and
// proceeds its own; the net line is ink.

export function CashFlowChart({ actual, schedule, simulation, accounting, fmt, fmtFull }: { actual: ActualCashFlow[]; schedule: ForecastSchedule; simulation: SimulationResult | null; accounting: boolean; fmt: Fmt; fmtFull: Fmt }) {
  const data = useMemo(() => {
    const rows: { label: string; called: number; distributed: number; carry: number; fees: number; expenses: number; expensesRaw: number; invested: number; distP10: number; distBand: number; period: 'Actual' | 'Forecast' }[] = actual.map(y => ({
      label: String(y.year),
      called: -y.called,
      distributed: y.distributed,
      carry: y.carriedInterest,
      fees: 0,
      expenses: accounting ? 0 : -y.expenses,
      expensesRaw: y.expenses,
      invested: y.invested,
      distP10: 0,
      distBand: 0,
      period: 'Actual',
    }))
    return schedule.years.slice(1).reduce<typeof rows>((forecastRows, y) => {
    const simulated = simulation?.years.find(point => point.year === y.year)?.distributed
    forecastRows.push({
      label: String(y.calendarYear),
      called: -(accounting ? y.called : y.invested),
      distributed: y.distributed,
      carry: accounting ? (y.carriedInterest ?? 0) : 0,
      fees: y.fees,
      expenses: accounting ? 0 : -(y.fees + y.expenses),
      expensesRaw: y.expenses,
      invested: y.invested,
      distP10: simulated?.p10 ?? y.distributed,
      distBand: simulated ? Math.max(0, simulated.p90 - simulated.p10) : 0,
      period: 'Forecast',
    })
    return forecastRows
    }, rows)
  }, [actual, schedule, simulation, accounting])

  const outflowLabel = accounting ? 'Called' : 'Invested'
  const inflowLabel = accounting ? 'Distributed' : 'Proceeds'
  const cashScale = useMemo(() => {
    const minimum = Math.min(0, ...data.map(row => row.called + row.expenses))
    const maximum = Math.max(0, ...data.map(row => Math.max(row.distributed + row.carry, row.distP10 + row.distBand)))
    return niceCurrencyScale(minimum, maximum)
  }, [data])

  return (
    <ChartCard title={`Actual and forecast ${accounting ? 'cash flows' : 'investment flows'} by year`}>
      {data.length === 0 ? (
        <EmptyPlot label="State the pacing assumptions to see the cash flows." />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} stackOffset="sign">
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} className="text-muted-foreground" />
              <YAxis domain={cashScale.domain} ticks={cashScale.ticks} allowDataOverflow tick={AXIS} tickLine={false} axisLine={false} width={48} tickFormatter={v => fmt(v as number)} className="text-muted-foreground" />
              <Tooltip
                cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
                contentStyle={tooltipStyle}
                labelFormatter={(label, payload) => `${label} · ${(payload?.[0]?.payload as { period?: string } | undefined)?.period ?? ''}`}
                formatter={(v: any, n: any, item: any) => {
                  if (n === outflowLabel && accounting) return [`${fmtFull(Math.abs(v as number))} · ${fmtFull(item?.payload?.invested ?? 0)} invested, ${fmtFull(item?.payload?.fees ?? 0)} fees, ${fmtFull((item?.payload?.expensesRaw ?? 0))} expenses`, n]
                  if (n === 'Expenses') return [fmtFull(Math.abs(v as number)), n]
                  return [fmtFull(v as number), n]
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              {simulation && <Area dataKey="distP10" stackId="distribution-band" stroke="none" fill="transparent" legendType="none" tooltipType="none" isAnimationActive={false} />}
              {simulation && <Area dataKey="distBand" name={`${inflowLabel} P10–P90`} stackId="distribution-band" stroke="none" fill={DISTRIBUTION_BAND} isAnimationActive={false} />}
              <Bar dataKey="called" name={outflowLabel} stackId="flow" fill={INVEST_NEW} maxBarSize={28} radius={[0, 0, 4, 4]} stroke={HUE.surface} strokeWidth={2} isAnimationActive={false} />
              {!accounting && <Bar dataKey="expenses" name="Expenses" stackId="flow" fill={HUE.chart4} maxBarSize={28} radius={[0, 0, 4, 4]} stroke={HUE.surface} strokeWidth={2} isAnimationActive={false} />}
              <Bar dataKey="distributed" name={inflowLabel} stackId="flow" fill={PROCEEDS_HUE} maxBarSize={28} radius={[4, 4, 0, 0]} stroke={HUE.surface} strokeWidth={2} isAnimationActive={false} />
              {accounting && <Bar dataKey="carry" name="Carried interest" stackId="flow" fill={HUE.chart4} maxBarSize={28} radius={[4, 4, 0, 0]} stroke={HUE.surface} strokeWidth={2} isAnimationActive={false} />}
            </ComposedChart>
          </ResponsiveContainer>
          <p className="mt-1 text-xs text-muted-foreground">{accounting
            ? 'Historical ledger cash flows continue into the forecast. Capital is called as each forecast year needs it; LP distributions and GP carried interest are separate, and the orange band is the simulated distribution P10–P90 range.'
            : 'Known investment and proceeds dates from the portfolio continue into the forecast. Forecast fund expenses are shown separately; the orange band is the simulated proceeds P10–P90 range.'}</p>
        </>
      )}
    </ChartCard>
  )
}

// ── Distribution of outcomes ─────────────────────────────────────────────────
//
// A histogram of final TVPI across every run — one hue, because the bars are one series — with the
// median and the target as reference lines. Columns are counts of runs, so the height reads as
// likelihood directly.

export function OutcomeHistogram({ simulation, target, multiple }: { simulation: SimulationResult | null; target: number; multiple: (v: number | null) => string }) {
  const data = useMemo(() => (simulation?.histogram ?? []).map(b => ({
    label: `${b.from.toFixed(1)}x`,
    from: b.from,
    to: b.to,
    count: b.count,
    share: simulation ? b.count / simulation.runs : 0,
  })), [simulation])

  const median = simulation?.final.tvpi.p50 ?? null
  const medianLabel = median != null ? data.find(d => median >= d.from && median < d.to)?.label ?? null : null
  const targetLabel = target > 0 ? data.find(d => target >= d.from && target < d.to)?.label ?? null : null

  return (
    <ChartCard title="Range of simulated outcomes">
      {!simulation || !simulation.stated ? (
        <EmptyPlot label="State a loss rate or a dispersion to run the simulation." />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 8 }} barCategoryGap={2}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" className="text-muted-foreground" />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => `${Math.round((v / simulation.runs) * 100)}%`} className="text-muted-foreground" />
              <Tooltip
                cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
                contentStyle={tooltipStyle}
                labelFormatter={(l, payload) => { const p = payload?.[0]?.payload as { from: number; to: number } | undefined; return p ? `${multiple(p.from)} to ${multiple(p.to)} TVPI` : String(l) }}
                formatter={(v: any) => [`${v} of ${simulation.runs} runs · ${Math.round(((v as number) / simulation.runs) * 100)}%`, 'Runs']}
              />
              {medianLabel && <ReferenceLine x={medianLabel} stroke={HUE.ink} strokeDasharray="4 4" label={{ value: `Median ${multiple(median)}`, position: 'top', fontSize: 11, fill: HUE.ink }} />}
              {targetLabel && targetLabel !== medianLabel && <ReferenceLine x={targetLabel} stroke={HUE.muted} strokeDasharray="4 4" label={{ value: `Target ${multiple(target)}`, position: 'insideTopRight', fontSize: 11, fill: HUE.muted }} />}
              <Bar dataKey="count" name="Runs" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {data.map(d => <Cell key={d.label} fill={TVPI_HUE} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-1 text-xs text-muted-foreground">
            Final TVPI at the end of the horizon across {simulation.runs.toLocaleString('en-US')} runs, in bins of half a turn.
          </p>
        </>
      )}
    </ChartCard>
  )
}
