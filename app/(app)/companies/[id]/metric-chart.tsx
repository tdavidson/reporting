'use client'

import { useState, useCallback, useMemo } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  BarChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts'
import type { Metric } from '@/lib/types/database'
import type { MetricValueRow } from './company-charts'
import { DataPointPopover } from './data-point-popover'
import { useCurrency, getCurrencySymbol } from '@/components/currency-context'

interface Props {
  metric: Metric
  values: MetricValueRow[]
  onRefresh: () => void
  compact?: boolean
}

interface ChartPoint {
  label: string
  value: number | null
  raw: MetricValueRow
}

/* eslint-disable @typescript-eslint/no-explicit-any */

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'hsl(var(--chart-1))',
  medium: 'hsl(var(--chart-4))',
  low: 'hsl(var(--destructive))',
}

function formatPeriodLabel(v: MetricValueRow): string {
  const { period_year, period_month, period_quarter } = v

  if (period_month != null) {
    const mm = String(period_month).padStart(2, '0')
    const yy = String(period_year).slice(-2)
    return `${mm}/${yy}`
  }

  if (period_quarter != null) {
    const yy = String(period_year).slice(-2)
    return `Q${period_quarter}.${yy}`
  }

  return String(period_year)
}

/** Estimate pixel width of a string at a given font size (monospace-safe approximation) */
function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.62
}

export function MetricChart({ metric, values, onRefresh, compact }: Props) {
  const fundCurrency = useCurrency()
  const [chartType, setChartType] = useState<'line' | 'bar'>('line')
  const [activePoint, setActivePoint] = useState<{
    data: MetricValueRow
    x: number
    y: number
  } | null>(null)

  const data: ChartPoint[] = values.map((v) => ({
    label: formatPeriodLabel(v),
    value: v.value_number,
    raw: v,
  }))

  const metricCurrency = metric.currency ?? fundCurrency
  const effectiveUnit = metric.unit ?? (metric.value_type === 'currency' ? getCurrencySymbol(metricCurrency) : null)
  const effectiveUnitPosition = metric.unit ? metric.unit_position : 'prefix'

  const formatValue = useCallback(
    (val: number | null) => {
      if (val === null) return '\u2014'
      const formatted =
        metric.value_type === 'percentage'
          ? `${val}%`
          : metric.value_type === 'currency'
            ? val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
            : val.toLocaleString()

      if (!effectiveUnit) return formatted
      return effectiveUnitPosition === 'prefix'
        ? `${effectiveUnit}${formatted}`
        : `${formatted} ${effectiveUnit}`
    },
    [metric, effectiveUnit, effectiveUnitPosition]
  )

  const formatYAxis = useCallback(
    (val: number) => {
      let str: string
      if (Math.abs(val) >= 1_000_000) str = `${(val / 1_000_000).toFixed(1)}M`
      else if (Math.abs(val) >= 1_000) str = `${(val / 1_000).toFixed(0)}K`
      else str = val.toString()

      if (effectiveUnit && effectiveUnitPosition === 'prefix') return `${effectiveUnit}${str}`
      if (metric.value_type === 'percentage') return `${str}%`
      return str
    },
    [metric, effectiveUnit, effectiveUnitPosition]
  )

  // Dynamically compute YAxis width from the longest formatted tick label
  const yAxisWidth = useMemo(() => {
    const tickFontSize = compact ? 9 : 11
    const numbers = data.map((d) => d.value).filter((v): v is number => v !== null)
    if (numbers.length === 0) return compact ? 40 : 56

    const maxVal = Math.max(...numbers)
    const minVal = Math.min(...numbers)
    const candidates = [maxVal, minVal, 0].map(formatYAxis)
    const longestLabel = candidates.reduce((a, b) => (a.length >= b.length ? a : b), '')
    const estimated = Math.ceil(estimateTextWidth(longestLabel, tickFontSize)) + 8 // 8px padding
    const minWidth = compact ? 36 : 48
    const maxWidth = compact ? 80 : 100
    return Math.min(Math.max(estimated, minWidth), maxWidth)
  }, [data, compact, formatYAxis])

  const handleClick = (payload: ChartPoint, e: React.MouseEvent) => {
    setActivePoint({
      data: payload.raw,
      x: e.clientX,
      y: e.clientY,
    })
  }

  const chartColor = 'hsl(var(--chart-1))'

  const chartHeight = compact ? 180 : 250
  const tickFontSize = compact ? 9 : 11

  const commonProps = {
    data,
    margin: compact
      ? { top: 4, right: 4, bottom: 0, left: 0 }
      : { top: 8, right: 8, bottom: 0, left: 8 },
  }

  return (
    <div>
      <div className="flex justify-end mb-1">
        <div className="inline-flex rounded-md border text-[10px]">
          <button
            onClick={() => setChartType('line')}
            className={`px-2 py-0.5 rounded-l-md transition-colors ${
              chartType === 'line'
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Line
          </button>
          <button
            onClick={() => setChartType('bar')}
            className={`px-2 py-0.5 rounded-r-md transition-colors ${
              chartType === 'bar'
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Bar
          </button>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={chartHeight}>
        {chartType === 'line' ? (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: tickFontSize }}
              className="text-muted-foreground"
              tickLine={false}
              axisLine={false}
              interval={compact ? 'preserveStartEnd' : 'equidistantPreserveStart'}
            />
            <YAxis
              tick={{ fontSize: tickFontSize }}
              className="text-muted-foreground"
              tickFormatter={formatYAxis}
              tickLine={false}
              axisLine={false}
              width={yAxisWidth}
            />
            <Tooltip
              formatter={(val: any) => [formatValue(val as number), metric.name]}
              contentStyle={{
                borderRadius: '6px',
                border: '1px solid hsl(var(--border))',
                backgroundColor: 'hsl(var(--popover))',
                color: 'hsl(var(--popover-foreground))',
                fontSize: '12px',
              }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={chartColor}
              strokeWidth={2}
              dot={(props: any) => {
                const { cx, cy, index } = props
                const point = data[index]
                if (!point) return <circle key={index} cx={cx} cy={cy} r={0} />
                const color = point.raw.is_manually_entered
                    ? 'hsl(var(--chart-1))'
                    : (CONFIDENCE_COLORS[point.raw.confidence] ?? chartColor)
                return (
                  <g key={index} className="cursor-pointer" onClick={(e: React.MouseEvent) => handleClick(point, e)}>
                    <circle cx={cx} cy={cy} r={3} fill='hsl(var(--background))' stroke={color} strokeWidth={1} strokeDasharray="none" />
                  </g>
                )
              }}
              activeDot={(props: any) => {
                const { cx, cy, index } = props
                const point = data[index]
                if (!point) return <circle key={index} cx={cx} cy={cy} r={0} />
                const color = point.raw.is_manually_entered
                    ? 'hsl(var(--chart-1))'
                    : (CONFIDENCE_COLORS[point.raw.confidence] ?? chartColor)
                const isManual = point.raw.is_manually_entered
                return (
                  <g key={index} className="cursor-pointer" onClick={(e: React.MouseEvent) => handleClick(point, e)}>
                    <circle cx={cx} cy={cy} r={3} fill={isManual ? 'hsl(var(--background))' : color} stroke={color} strokeWidth={1} strokeDasharray="none" />
                  </g>
                )
              }}
            />
          </LineChart>
        ) : (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: tickFontSize }}
              className="text-muted-foreground"
              tickLine={false}
              axisLine={false}
              interval={compact ? 'preserveStartEnd' : 'equidistantPreserveStart'}
            />
            <YAxis
              tick={{ fontSize: tickFontSize }}
              className="text-muted-foreground"
              tickFormatter={formatYAxis}
              tickLine={false}
              axisLine={false}
              width={yAxisWidth}
            />
            <Tooltip
              formatter={(val: any) => [formatValue(val as number), metric.name]}
              contentStyle={{
                borderRadius: '6px',
                border: '1px solid hsl(var(--border))',
                backgroundColor: 'hsl(var(--popover))',
                color: 'hsl(var(--popover-foreground))',
                fontSize: '12px',
              }}
            />
            <Bar
              dataKey="value"
              radius={[4, 4, 0, 0]}
              className="cursor-pointer"
              onClick={(payload: any, _index: number, e: any) =>
                handleClick(payload as ChartPoint, e as React.MouseEvent)
              }
            >
              {data.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.raw.is_manually_entered ? 'hsl(var(--chart-1))' : (CONFIDENCE_COLORS[entry.raw.confidence] ?? chartColor)}
                  fillOpacity={entry.raw.is_manually_entered ? 0.5 : 0.5}
                  strokeDasharray="none"
                  stroke={entry.raw.is_manually_entered ? 'hsl(var(--chart-1))' : (CONFIDENCE_COLORS[entry.raw.confidence] ?? chartColor)}
                  strokeWidth={1}
                />
              ))}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>

      {activePoint && (
        <DataPointPopover
          dataPoint={activePoint.data}
          metric={metric}
          position={{ x: activePoint.x, y: activePoint.y }}
          onClose={() => setActivePoint(null)}
          onRefresh={onRefresh}
          formatValue={formatValue}
        />
      )}
    </div>
  )
}
