'use client'

import { useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, ReferenceLine, LabelList,
} from 'recharts'
import {
  ChartCard, EmptyPlot, AXIS, tooltipStyle, HUE, sliceFill,
  INVEST_NEW, INVEST_FOLLOW,
} from '@/components/fund-chart-kit'
import { valueSources, type ConstructionResult } from '@/lib/accounting/construction'

/**
 * Three pictures of the plan the tables state in numbers.
 *
 * All three are COMPOSITIONS or SCENARIOS, never time series. The construction model carries no
 * pacing assumption — nothing in it says when a check is written — so any chart with a date axis
 * here would be inventing its own schedule. See the header of lib/accounting/construction.ts.
 *
 * They reuse the /funds/[id] chart vocabulary through components/fund-chart-kit, so "invested
 * capital" is the same hue on both pages.
 */

type Fmt = (v: number | null) => string

// ── Committed capital usage ──────────────────────────────────────────────────
//
// One horizontal 100% bar rather than the vertical stacks on the fund page: there is a single
// total here, not a series, and laid on its side the segments carry their own labels. Capital
// into deals is one hue split by intensity (deployed solid, planned as its tint) so the eye reads
// "investment" as one block that happens to be part-done; expenses take their own slots; what is
// left over is muted ink, because unallocated capital is an absence, not a category.
const USAGE_SERIES = [
  { key: 'deployed', name: 'Invested to date', color: INVEST_NEW },
  { key: 'planned', name: 'Planned investments', color: INVEST_FOLLOW },
  { key: 'fees', name: 'Management fees', color: HUE.chart4 },
  { key: 'expenses', name: 'Fund expenses', color: HUE.chart5 },
  { key: 'unallocated', name: 'Unallocated', color: HUE.muted },
] as const

export function CapitalUsageChart({ model, fmt, fmtFull }: { model: ConstructionResult; fmt: Fmt; fmtFull: Fmt }) {
  const { capital } = model
  const committed = capital.committedCapital

  const row = useMemo(() => ({
    label: 'Committed',
    deployed: capital.deployedTotal,
    planned: capital.plannedCost,
    fees: capital.lifetimeFees,
    // Org costs and partnership expenses read as one thing against management fees; the Capital
    // planning table directly below breaks them apart for anyone who needs the split.
    expenses: capital.lifetimeExpenses,
    // A plan that overruns has nothing left over — the shortfall is already shown as a warning
    // above, and a negative segment here would break the "these sum to committed" reading.
    unallocated: Math.max(0, committed - capital.deployedTotal - capital.plannedCost - capital.lifetimeFees - capital.lifetimeExpenses),
  }), [capital, committed])

  const series = USAGE_SERIES.filter(s => Math.abs(row[s.key]) > 0.5)
  const pctOf = (v: number) => (committed > 0 ? `${Math.round((v / committed) * 100)}%` : '—')

  return (
    <ChartCard title="Committed capital usage">
      {committed <= 0 ? (
        <EmptyPlot label="No committed capital recorded." />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={110}>
            <BarChart data={[row]} layout="vertical" margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
              <XAxis type="number" domain={[0, committed]} tick={AXIS} tickLine={false} axisLine={false} tickFormatter={v => fmt(v as number)} className="text-muted-foreground" />
              <YAxis type="category" dataKey="label" hide />
              <Tooltip
                cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
                contentStyle={tooltipStyle}
                formatter={(v: any, n: any) => [`${fmtFull(v as number)} · ${pctOf(v as number)}`, n]}
              />
              {series.map(s => (
                <Bar key={s.key} dataKey={s.key} name={s.name} stackId="usage" fill={s.color} stroke={HUE.surface} strokeWidth={2} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          {/* A legend list rather than recharts' own: it carries the dollar and the percentage,
              which is what makes this agree line-for-line with the Capital planning table. */}
          <ul className="mt-1 space-y-1.5 text-xs">
            {series.map(s => (
              <li key={s.key} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{fmt(row[s.key])}</span>
                <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground/70">{pctOf(row[s.key])}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </ChartCard>
  )
}

// ── Sources of total value ───────────────────────────────────────────────────
//
// A donut, so it uses the ALL-PAIRS slice palette (see fund-chart-kit): three slices sitting
// against each other in every combination.

export function ValueSourcesChart({ model, fmt, fmtFull }: { model: ConstructionResult; fmt: Fmt; fmtFull: Fmt }) {
  const sources = useMemo(() => valueSources(model), [model])

  const data = useMemo(() => {
    // A marked-down book has a negative forecast gain. Rather than paint a negative slice, the
    // cost segment shrinks to what the forecast actually supports — the same treatment the fund
    // page gives an underwater carrying value — so the ring still totals the forecasted value.
    const gain = sources.forecastGain
    const invested = gain >= 0 ? sources.investedAtWork : Math.max(0, sources.investedAtWork + gain)
    return [
      { name: 'Realized proceeds', value: Math.max(0, sources.realizedProceeds), color: sliceFill(0) },
      { name: 'Invested capital at work', value: invested, color: sliceFill(1) },
      { name: 'Unrealized gains', value: Math.max(0, gain), color: sliceFill(2) },
    ].filter(d => d.value > 0.5)
  }, [sources])

  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <ChartCard title="Sources of total value">
      {total === 0 ? (
        <EmptyPlot label="No proceeds or forecast yet." />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={150}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={68} paddingAngle={2} stroke={HUE.surface} strokeWidth={2}>
                {data.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [fmtFull(v as number), n]} />
            </PieChart>
          </ResponsiveContainer>
          <ul className="mt-1 space-y-1.5 text-xs">
            {data.map(d => (
              <li key={d.name} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
                <span className="min-w-0 flex-1 truncate">{d.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{fmt(d.value)}</span>
                <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground/70">
                  {total ? `${Math.round((d.value / total) * 100)}%` : '—'}
                </span>
              </li>
            ))}
          </ul>
          {sources.forecastGain < 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              The forecast sits {fmt(Math.abs(sources.forecastGain))} below the cost still at work.
            </p>
          )}
        </>
      )}
    </ChartCard>
  )
}

// ── Range of return outcomes ─────────────────────────────────────────────────
//
// Net fund MOIC across the ownership-at-exit scenarios the model already derives from the plan.
// Columns, not a line: the five scenarios are discrete what-ifs (the plan ±1 and ±2 ownership
// points), and net MOIC is linear in ownership with everything else held, so a line through them
// is always straight and reads as a trajectory that does not exist. Emphasis form — the plan as
// entered in the accent hue, the what-ifs in de-emphasis grey — so the eye lands on the one
// column that is a decision and reads the others as its spread.
//
// ONE y-axis: `exitToReturnFund` is a dollar figure on a wholly different scale, so it lives in
// the tooltip rather than on a second axis.

const WHAT_IF_FILL = 'hsl(var(--muted-foreground) / 0.35)'

export function ReturnRangeChart({ model, fmt, multiple }: { model: ConstructionResult; fmt: Fmt; multiple: (v: number | null) => string }) {
  const { sensitivity, targetFundMultiple } = model.returns

  const data = useMemo(() => sensitivity.map(row => ({
    ownership: row.ownershipAtExit,
    label: `${(row.ownershipAtExit * 100).toFixed(1)}%`,
    netMoic: row.netMoic,
    exitToReturnFund: row.exitToReturnFund,
    isPlan: row.isWeightedAverage,
  })), [sensitivity])

  const hasTarget = targetFundMultiple > 0
  const last = data.length - 1

  return (
    <ChartCard title="Range of return outcomes">
      {data.length === 0 ? (
        <EmptyPlot label="Add ownership forecasts to see return scenarios." />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={hasTarget ? 176 : 190}>
            <BarChart data={data} margin={{ top: 16, right: 12, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} className="text-muted-foreground" />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} tickFormatter={v => `${(v as number).toFixed(1)}x`} className="text-muted-foreground" />
              <Tooltip
                cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
                contentStyle={tooltipStyle}
                labelFormatter={l => `${l} ownership at exit`}
                formatter={(v: any, _n: any, item: any) => [
                  `${multiple(v as number)} · one exit at ${fmt(item?.payload?.exitToReturnFund ?? null)} returns the fund`,
                  item?.payload?.isPlan ? 'Net MOIC (plan)' : 'Net MOIC',
                ]}
              />
              {hasTarget && (
                <ReferenceLine
                  y={targetFundMultiple}
                  stroke={HUE.muted}
                  strokeDasharray="4 4"
                  label={{ value: `Target ${targetFundMultiple}x`, position: 'insideTopLeft', fontSize: 11, fill: HUE.muted }}
                />
              )}
              <Bar dataKey="netMoic" name="Net MOIC" maxBarSize={24} radius={[4, 4, 0, 0]}>
                {data.map(d => <Cell key={d.label} fill={d.isPlan ? HUE.chart1 : WHAT_IF_FILL} />)}
                {/* Direct labels on the plan and the two ends only: enough to read the spread
                    without a number on every column. */}
                <LabelList
                  dataKey="netMoic"
                  position="top"
                  fontSize={11}
                  fill={HUE.muted}
                  formatter={(v: any) => multiple(v as number)}
                  content={(props: any) => {
                    const i = props.index as number
                    if (!(data[i]?.isPlan || i === 0 || i === last)) return null
                    return (
                      <text x={props.x + props.width / 2} y={props.y - 4} textAnchor="middle" fontSize={11} fill={data[i]?.isPlan ? HUE.ink : HUE.muted} className="tabular-nums">
                        {multiple(props.value as number)}
                      </text>
                    )
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-1 text-xs text-muted-foreground">
            Net MOIC on committed capital if the portfolio exits at each average ownership. The
            solid column is the plan as entered; the grey columns move it ±1 and ±2 points.
          </p>
        </>
      )}
    </ChartCard>
  )
}
