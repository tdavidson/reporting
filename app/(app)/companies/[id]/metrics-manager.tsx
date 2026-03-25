'use client'

import { useState } from 'react'
import { ArrowUp, ArrowDown, Eye, EyeOff, SlidersHorizontal } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface Metric {
  id: string
  name: string
  is_active: boolean
  display_order: number
}

interface Props {
  companyId: string
  initialMetrics: Metric[]
}

export function MetricsManager({ companyId, initialMetrics }: Props) {
  const [metrics, setMetrics] = useState(
    [...initialMetrics].sort((a, b) => a.display_order - b.display_order)
  )
  const [saving, setSaving] = useState<string | null>(null)

  async function patch(metricId: string, updates: Partial<Metric>) {
    setSaving(metricId)
    await fetch(`/api/companies/${companyId}/metrics/${metricId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    setSaving(null)
  }

  async function toggleActive(metricId: string) {
    const updated = metrics.map(m =>
      m.id === metricId ? { ...m, is_active: !m.is_active } : m
    )
    setMetrics(updated)
    const metric = updated.find(m => m.id === metricId)!
    await patch(metricId, { is_active: metric.is_active })
  }

  async function move(index: number, dir: -1 | 1) {
    const next = [...metrics]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    const reordered = next.map((m, i) => ({ ...m, display_order: i }))
    setMetrics(reordered)
    await Promise.all([
      patch(reordered[index].id, { display_order: reordered[index].display_order }),
      patch(reordered[target].id, { display_order: reordered[target].display_order }),
    ])
  }

  if (metrics.length === 0) return null

  const activeMetrics = metrics.filter(m => m.is_active)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Configure portfolio card metrics"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Portfolio Card Metrics
        </p>
        <div className="space-y-1">
          {metrics.map((metric, i) => {
            const activeIndex = activeMetrics.indexOf(metric)
            const isCardMetric = metric.is_active && activeIndex < 2
            return (
              <div
                key={metric.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
                  metric.is_active ? '' : 'opacity-40'
                }`}
              >
                <span className="flex-1 text-sm truncate">{metric.name}</span>
                {isCardMetric && (
                  <span className="text-[10px] text-primary font-medium bg-primary/10 px-1.5 py-0.5 rounded shrink-0">
                    Card
                  </span>
                )}
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => move(i, -1)}
                    disabled={i === 0 || saving === metric.id}
                    className="p-1 rounded hover:bg-muted disabled:opacity-20 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => move(i, 1)}
                    disabled={i === metrics.length - 1 || saving === metric.id}
                    className="p-1 rounded hover:bg-muted disabled:opacity-20 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => toggleActive(metric.id)}
                    disabled={saving === metric.id}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    title={metric.is_active ? 'Deactivate' : 'Activate'}
                  >
                    {metric.is_active ? (
                      <Eye className="h-3.5 w-3.5" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        <p className="text-[10px] text-muted-foreground mt-3">
          The first 2 active metrics appear on the portfolio card.
        </p>
      </PopoverContent>
    </Popover>
  )
}
