'use client'

import { useEffect, useState } from 'react'
import { ResponsiveContainer, LineChart, Line } from 'recharts'
import { useCurrency, getCurrencySymbol } from '@/components/currency-context'

interface SparkMetric {
  id: string
  name: string
  unit: string | null
  unit_position: string
  value_type: string
  currency: string | null
}

interface Props {
  companyId: string
  metrics: SparkMetric[]
}

interface ValuePoint {
  period_label: string
  value_number: number | null
}

const SPARK_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
]

export function DashboardSparklines({ companyId, metrics }: Props) {
  const fundCurrency = useCurrency()
  const [data, setData] = useState<Record<string, ValuePoint[]>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const results: Record<string, ValuePoint[]> = {}
      await Promise.all(
        metrics.map(async (m) => {
          const res = await fetch(`/api/companies/${companyId}/metrics/${m.id}/values`)
          if (res.ok) {
            const values = await res.json()
            results[m.id] = values.map((v: { period_label: string; value_number: number | null }) => ({
              period_label: v.period_label,
              value_number: v.value_number,
            }))
          }
        })
      )
      if (!cancelled) {
        setData(results)
        setLoaded(true)
      }
    }
    load()
    return () => { cancelled = true }
  }, [companyId, metrics])

  if (!loaded) {
    return <div className="h-10" />
  }

  return (
    <div className="space-y-2">
      {metrics.map((m, i) => {
        const values = data[m.id]
        if (!values || values.length < 2) return null

        const lastVal = values[values.length - 1]?.value_number
        const metricCurrency = m.currency ?? fundCurrency
        const effectiveUnit = m.unit ?? (m.value_type === 'currency' ? getCurrencySymbol(metricCurrency) : null)
        const effectivePos = m.unit ? m.unit_position : 'prefix'
        const formatVal = (v: number | null) => {
          if (v === null) return '—'
          let str: string
          if (Math.abs(v) >= 1_000_000) str = `${(v / 1_000_000).toFixed(1)}M`
          else if (Math.abs(v) >= 1_000) str = `${(v / 1_000).toFixed(0)}K`
          else str = v.toLocaleString()
          if (effectiveUnit && effectivePos === 'prefix') return `${effectiveUnit}${str}`
          if (m.value_type === 'percentage') return `${str}%`
          if (effectiveUnit && effectivePos === 'suffix') return `${str} ${effectiveUnit}`
          return str
        }

        return (
          <div key={m.id} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-16 truncate">{m.name}</span>
            <div className="flex-1 h-6">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={values}>
                  <Line
                    type="monotone"
                    dataKey="value_number"
                    stroke={SPARK_COLORS[i] ?? SPARK_COLORS[0]}
                    strokeWidth={1.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <span className="text-[10px] font-medium w-14 text-right tabular-nums">
              {formatVal(lastVal ?? null)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
