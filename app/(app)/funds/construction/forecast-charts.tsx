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

const TVPI_HUE = HUE.chart1
const DPI_HUE = HUE.chart2
const BAND_OUTER = 'hsl(var(--chart-1) / 0.12)'
const BAND_INNER = 'hsl(var(--chart-1) / 0.24)'

// ── J-curve: DPI and TVPI over time, history solid and forecast dashed ────────
//
// ONE axis, in multiples of called capital. Called capital and distributions in dollars belong on
// the cash-flow chart beside this one, not on a second axis here. The simulation's spread sits
// behind the forecast line as two bands of the TVPI hue at two opacities — a sequential encoding of
// "how likely", not a second series — and the legend names the lines; the caption names the bands.

export function JCurveChart({ actual, schedule, simulation, multiple }: {
  actual: ActualPoint[]
  schedule: ForecastSchedule
  simulation: SimulationResult | null
  multiple: (v: number | null) => string
}) {
  const data = useMemo(() => {
    const baseYear = schedule.years[0]?.calendarYear ?? new Date().getFullYear()
    const rows = new Map<number, Record<string, number | [number, number] | null | string>>()
    for (const p of actual) {
      rows.set(p.x, { x: p.x, label: p.label, tvpiActual: p.tvpi, dpiActual: p.dpi })
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
        row.outer = [sim.tvpi.p10, sim.tvpi.p90]
        row.inner = [sim.tvpi.p25, sim.tvpi.p75]
      }
      rows.set(x, row)
    }
    return Array.from(rows.values()).sort((a, b) => (a.x as number) - (b.x as number))
  }, [actual, schedule, simulation])

  const hasForecast = schedule.years.length > 1
  const hasBand = !!simulation && simulation.stated

  return (
    <ChartCard title="DPI and TVPI over time">
      {!hasForecast ? (
        <EmptyPlot label="State the pacing assumptions to see the J-curve." />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
              <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v: number) => String(Math.round(v))} allowDecimals={false} className="text-muted-foreground" />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => `${v.toFixed(1)}x`} className="text-muted-foreground" />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(_l, payload) => String((payload?.[0]?.payload as { label?: string } | undefined)?.label ?? '')}
                formatter={(v: any, n: any) => {
                  if (Array.isArray(v)) return [`${multiple(v[0])} – ${multiple(v[1])}`, n]
                  return [multiple(v as number), n]
                }}
              />
              <ReferenceLine y={1} stroke="hsl(var(--border))" />
              {hasBand && <Area dataKey="outer" name="TVPI, 10th–90th percentile" stroke="none" fill={BAND_OUTER} isAnimationActive={false} connectNulls legendType="none" />}
              {hasBand && <Area dataKey="inner" name="TVPI, 25th–75th percentile" stroke="none" fill={BAND_INNER} isAnimationActive={false} connectNulls legendType="none" />}
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
            {hasBand && <li className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm" style={{ background: BAND_INNER }} /> Simulation band</li>}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">
            Solid is the fund to date; dashed is the plan on the stated pacing.
            {hasBand ? ' The shaded bands are the simulation’s 25th–75th and 10th–90th percentiles of TVPI.' : ''}
            {' '}Multiples are on called capital, before carry.
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

export function CashFlowChart({ schedule, fmt, fmtFull }: { schedule: ForecastSchedule; fmt: Fmt; fmtFull: Fmt }) {
  const data = useMemo(() => schedule.years.slice(1).reduce<{ label: string; called: number; distributed: number; net: number; fees: number; invested: number }[]>((rows, y) => {
    const prev = rows.length > 0 ? rows[rows.length - 1].net : 0
    rows.push({ label: String(y.calendarYear), called: -y.called, distributed: y.distributed, net: prev + y.distributed - y.called, fees: y.fees, invested: y.invested })
    return rows
  }, []), [schedule])

  return (
    <ChartCard title="Forecast cash flows by year">
      {data.length === 0 ? (
        <EmptyPlot label="State the pacing assumptions to see the cash flows." />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} stackOffset="sign">
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} className="text-muted-foreground" />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} tickFormatter={v => fmt(v as number)} className="text-muted-foreground" />
              <Tooltip
                cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
                contentStyle={tooltipStyle}
                formatter={(v: any, n: any, item: any) => {
                  if (n === 'Called') return [`${fmtFull(Math.abs(v as number))} · ${fmtFull(item?.payload?.invested ?? 0)} invested, ${fmtFull(item?.payload?.fees ?? 0)} fees`, n]
                  return [fmtFull(v as number), n]
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <Bar dataKey="called" name="Called" stackId="flow" fill={INVEST_NEW} maxBarSize={28} radius={[0, 0, 4, 4]} stroke={HUE.surface} strokeWidth={2} isAnimationActive={false} />
              <Bar dataKey="distributed" name="Distributed" stackId="flow" fill={PROCEEDS_HUE} maxBarSize={28} radius={[4, 4, 0, 0]} stroke={HUE.surface} strokeWidth={2} isAnimationActive={false} />
              <Line type="monotone" dataKey="net" name="Cumulative net" stroke={HUE.ink} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="mt-1 text-xs text-muted-foreground">Capital is called as each year needs it; proceeds go back out in the year a deal exits, before carry.</p>
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
